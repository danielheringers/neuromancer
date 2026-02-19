use std::ffi::OsString;
use std::path::Component;
use std::path::Path;
use std::path::PathBuf;

use codex_protocol::protocol::AskForApproval;
use codex_protocol::protocol::SandboxPolicy;
use thiserror::Error;

use crate::PermissionProfile;
use crate::PolicyDecision;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveRuntimePolicy {
    pub approval_policy: AskForApproval,
    pub sandbox_policy: SandboxPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceGuardResult {
    pub canonical_workspace: PathBuf,
    pub canonical_target: PathBuf,
}

#[derive(Debug, Error)]
pub enum PolicyBridgeError {
    #[error("failed to canonicalize workspace root `{workspace}`: {source}")]
    WorkspaceCanonicalizationFailed {
        workspace: String,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to canonicalize target `{target}`: {source}")]
    TargetCanonicalizationFailed {
        target: String,
        #[source]
        source: std::io::Error,
    },
    #[error(
        "target `{target}` is outside workspace `{workspace}` and was denied by workspace guard"
    )]
    TargetOutsideWorkspace { workspace: String, target: String },
}

pub fn map_profile_to_runtime_policy(profile: PermissionProfile) -> EffectiveRuntimePolicy {
    match profile {
        PermissionProfile::ReadOnly => EffectiveRuntimePolicy {
            approval_policy: AskForApproval::Never,
            sandbox_policy: SandboxPolicy::new_read_only_policy(),
        },
        PermissionProfile::ReadWriteWithApproval => EffectiveRuntimePolicy {
            approval_policy: AskForApproval::OnRequest,
            sandbox_policy: SandboxPolicy::new_workspace_write_policy(),
        },
        PermissionProfile::FullAccess => EffectiveRuntimePolicy {
            approval_policy: AskForApproval::Never,
            sandbox_policy: SandboxPolicy::DangerFullAccess,
        },
    }
}

pub fn network_decision_for_profile(profile: PermissionProfile) -> PolicyDecision {
    match profile {
        PermissionProfile::ReadOnly => PolicyDecision::Deny,
        PermissionProfile::ReadWriteWithApproval => PolicyDecision::RequireApproval,
        PermissionProfile::FullAccess => PolicyDecision::Allow,
    }
}

pub fn ensure_target_in_workspace(
    workspace_root: &Path,
    target: &Path,
) -> Result<WorkspaceGuardResult, PolicyBridgeError> {
    let canonical_workspace = std::fs::canonicalize(workspace_root).map_err(|source| {
        PolicyBridgeError::WorkspaceCanonicalizationFailed {
            workspace: workspace_root.to_string_lossy().to_string(),
            source,
        }
    })?;
    let candidate = resolve_candidate_path(&canonical_workspace, target);
    let canonical_target = canonicalize_with_missing_suffix(&candidate).map_err(|source| {
        PolicyBridgeError::TargetCanonicalizationFailed {
            target: candidate.to_string_lossy().to_string(),
            source,
        }
    })?;

    if !canonical_target.starts_with(&canonical_workspace) {
        return Err(PolicyBridgeError::TargetOutsideWorkspace {
            workspace: canonical_workspace.to_string_lossy().to_string(),
            target: canonical_target.to_string_lossy().to_string(),
        });
    }

    Ok(WorkspaceGuardResult {
        canonical_workspace,
        canonical_target,
    })
}

fn resolve_candidate_path(workspace_root: &Path, target: &Path) -> PathBuf {
    let normalized = normalize_path(target);
    if normalized.is_absolute() {
        normalized
    } else {
        workspace_root.join(normalized)
    }
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if normalized.file_name().is_some() {
                    normalized.pop();
                } else if !normalized.has_root() {
                    normalized.push(component.as_os_str());
                }
            }
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                normalized.push(component.as_os_str())
            }
        }
    }
    normalized
}

fn canonicalize_with_missing_suffix(path: &Path) -> std::io::Result<PathBuf> {
    if path.exists() {
        return std::fs::canonicalize(path);
    }

    let mut missing_segments: Vec<OsString> = Vec::new();
    let mut cursor = path;

    while !cursor.exists() {
        let Some(file_name) = cursor.file_name() else {
            return std::fs::canonicalize(cursor);
        };
        missing_segments.push(file_name.to_os_string());
        let Some(parent) = cursor.parent() else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "no existing parent while canonicalizing target path",
            ));
        };
        cursor = parent;
    }

    let mut canonical = std::fs::canonicalize(cursor)?;
    for segment in missing_segments.iter().rev() {
        canonical.push(segment);
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use codex_protocol::protocol::AskForApproval;
    use codex_protocol::protocol::SandboxPolicy;
    use pretty_assertions::assert_eq;
    use tempfile::TempDir;

    use super::PolicyBridgeError;
    use super::ensure_target_in_workspace;
    use super::map_profile_to_runtime_policy;
    use super::network_decision_for_profile;
    use crate::PermissionProfile;
    use crate::PolicyDecision;

    #[cfg(unix)]
    fn create_symlink_dir(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(src, dst)
    }

    #[cfg(windows)]
    fn create_symlink_dir(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_dir(src, dst)
    }

    #[test]
    fn read_only_profile_maps_to_restricted_runtime() {
        let mapped = map_profile_to_runtime_policy(PermissionProfile::ReadOnly);

        assert_eq!(mapped.approval_policy, AskForApproval::Never);
        assert_eq!(mapped.sandbox_policy, SandboxPolicy::new_read_only_policy());
    }

    #[test]
    fn read_write_with_approval_maps_to_workspace_write_runtime() {
        let mapped = map_profile_to_runtime_policy(PermissionProfile::ReadWriteWithApproval);

        assert_eq!(mapped.approval_policy, AskForApproval::OnRequest);
        assert_eq!(
            mapped.sandbox_policy,
            SandboxPolicy::new_workspace_write_policy()
        );
    }

    #[test]
    fn full_access_profile_maps_to_unrestricted_runtime() {
        let mapped = map_profile_to_runtime_policy(PermissionProfile::FullAccess);

        assert_eq!(mapped.approval_policy, AskForApproval::Never);
        assert_eq!(mapped.sandbox_policy, SandboxPolicy::DangerFullAccess);
    }

    #[test]
    fn network_decision_follows_profile_contract() {
        assert_eq!(
            network_decision_for_profile(PermissionProfile::ReadOnly),
            PolicyDecision::Deny
        );
        assert_eq!(
            network_decision_for_profile(PermissionProfile::ReadWriteWithApproval),
            PolicyDecision::RequireApproval
        );
        assert_eq!(
            network_decision_for_profile(PermissionProfile::FullAccess),
            PolicyDecision::Allow
        );
    }

    #[test]
    fn workspace_guard_allows_target_inside_workspace() -> anyhow::Result<()> {
        let workspace = TempDir::new()?;
        let nested_dir = workspace.path().join("src");
        std::fs::create_dir_all(&nested_dir)?;
        let target = PathBuf::from("src/generated/file.txt");

        let result = ensure_target_in_workspace(workspace.path(), &target)?;
        assert!(
            result
                .canonical_target
                .starts_with(&result.canonical_workspace)
        );
        Ok(())
    }

    #[test]
    fn workspace_guard_blocks_traversal_outside_workspace() -> anyhow::Result<()> {
        let workspace = TempDir::new()?;
        let target = PathBuf::from("../outside.txt");

        let result = ensure_target_in_workspace(workspace.path(), &target);
        assert!(matches!(
            result,
            Err(PolicyBridgeError::TargetOutsideWorkspace { .. })
        ));

        Ok(())
    }

    #[test]
    fn workspace_guard_blocks_symlink_escape() -> anyhow::Result<()> {
        let root = TempDir::new()?;
        let workspace = root.path().join("workspace");
        let outside = root.path().join("outside");
        std::fs::create_dir_all(&workspace)?;
        std::fs::create_dir_all(&outside)?;

        let link = workspace.join("link_outside");
        if let Err(err) = create_symlink_dir(&outside, &link) {
            // Some Windows environments deny symlink creation without developer mode.
            if err.kind() == std::io::ErrorKind::PermissionDenied
                || err.raw_os_error() == Some(1314)
            {
                return Ok(());
            }
            return Err(err.into());
        }

        let target = PathBuf::from("link_outside/new.txt");
        let result = ensure_target_in_workspace(&workspace, &target);
        assert!(matches!(
            result,
            Err(PolicyBridgeError::TargetOutsideWorkspace { .. })
        ));

        Ok(())
    }
}
