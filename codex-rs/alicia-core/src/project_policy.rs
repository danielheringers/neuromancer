use std::path::Path;
use std::path::PathBuf;

use serde::Deserialize;
use serde::Serialize;
use thiserror::Error;

use crate::EffectiveRuntimePolicy;
use crate::PermissionProfile;
use crate::PolicyDecision;
use crate::map_profile_to_runtime_policy;
use crate::network_decision_for_profile;

pub const PROJECT_POLICY_RELATIVE_PATH: &str = ".codex/alicia-policy.toml";
pub const PROJECT_POLICY_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectPolicyConfig {
    #[serde(default = "project_policy_schema_version")]
    pub schema_version: u32,
    pub permission_profile: PermissionProfile,
}

#[derive(Debug, Error)]
pub enum ProjectPolicyConfigError {
    #[error("failed to read project policy file `{path}`: {source}")]
    ReadFailed {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to parse project policy file `{path}`: {source}")]
    ParseFailed {
        path: String,
        #[source]
        source: toml::de::Error,
    },
    #[error(
        "unsupported project policy schema version `{found}` in `{path}`; expected `{expected}`"
    )]
    UnsupportedSchemaVersion {
        path: String,
        expected: u32,
        found: u32,
    },
}

pub fn project_policy_file_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(PROJECT_POLICY_RELATIVE_PATH)
}

pub fn load_project_policy(
    workspace_root: &Path,
) -> Result<Option<ProjectPolicyConfig>, ProjectPolicyConfigError> {
    let config_path = project_policy_file_path(workspace_root);
    let raw_config = match std::fs::read_to_string(&config_path) {
        Ok(contents) => contents,
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(ProjectPolicyConfigError::ReadFailed {
                path: config_path.to_string_lossy().to_string(),
                source,
            });
        }
    };

    let config: ProjectPolicyConfig =
        toml::from_str(&raw_config).map_err(|source| ProjectPolicyConfigError::ParseFailed {
            path: config_path.to_string_lossy().to_string(),
            source,
        })?;

    if config.schema_version != PROJECT_POLICY_SCHEMA_VERSION {
        return Err(ProjectPolicyConfigError::UnsupportedSchemaVersion {
            path: config_path.to_string_lossy().to_string(),
            expected: PROJECT_POLICY_SCHEMA_VERSION,
            found: config.schema_version,
        });
    }

    Ok(Some(config))
}

pub fn resolve_effective_profile(
    workspace_root: &Path,
    fallback_profile: PermissionProfile,
) -> Result<PermissionProfile, ProjectPolicyConfigError> {
    let override_config = load_project_policy(workspace_root)?;
    Ok(override_config.map_or(fallback_profile, |config| config.permission_profile))
}

pub fn resolve_effective_runtime_policy(
    workspace_root: &Path,
    fallback_profile: PermissionProfile,
) -> Result<EffectiveRuntimePolicy, ProjectPolicyConfigError> {
    let effective_profile = resolve_effective_profile(workspace_root, fallback_profile)?;
    Ok(map_profile_to_runtime_policy(effective_profile))
}

pub fn resolve_effective_network_decision(
    workspace_root: &Path,
    fallback_profile: PermissionProfile,
) -> Result<PolicyDecision, ProjectPolicyConfigError> {
    let effective_profile = resolve_effective_profile(workspace_root, fallback_profile)?;
    Ok(network_decision_for_profile(effective_profile))
}

fn project_policy_schema_version() -> u32 {
    PROJECT_POLICY_SCHEMA_VERSION
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use tempfile::TempDir;

    use super::PROJECT_POLICY_RELATIVE_PATH;
    use super::PROJECT_POLICY_SCHEMA_VERSION;
    use super::ProjectPolicyConfig;
    use super::ProjectPolicyConfigError;
    use super::load_project_policy;
    use super::resolve_effective_network_decision;
    use super::resolve_effective_profile;
    use super::resolve_effective_runtime_policy;
    use crate::PermissionProfile;
    use crate::PolicyDecision;
    use crate::map_profile_to_runtime_policy;

    fn write_project_policy_file(workspace: &TempDir, contents: &str) -> anyhow::Result<()> {
        let config_path = workspace.path().join(PROJECT_POLICY_RELATIVE_PATH);
        let Some(parent) = config_path.parent() else {
            anyhow::bail!("expected config path to have a parent");
        };
        std::fs::create_dir_all(parent)?;
        std::fs::write(config_path, contents)?;
        Ok(())
    }

    #[test]
    fn load_project_policy_returns_none_when_file_is_missing() -> anyhow::Result<()> {
        let workspace = TempDir::new()?;

        let loaded = load_project_policy(workspace.path())?;
        assert_eq!(loaded, None);

        Ok(())
    }

    #[test]
    fn load_project_policy_accepts_schema_version_default() -> anyhow::Result<()> {
        let workspace = TempDir::new()?;
        write_project_policy_file(
            &workspace,
            r#"
permission_profile = "read_write_with_approval"
"#,
        )?;

        let loaded = load_project_policy(workspace.path())?;
        let expected = Some(ProjectPolicyConfig {
            schema_version: PROJECT_POLICY_SCHEMA_VERSION,
            permission_profile: PermissionProfile::ReadWriteWithApproval,
        });
        assert_eq!(loaded, expected);

        Ok(())
    }

    #[test]
    fn resolve_effective_profile_applies_project_override() -> anyhow::Result<()> {
        let workspace = TempDir::new()?;
        write_project_policy_file(
            &workspace,
            r#"
schema_version = 1
permission_profile = "full_access"
"#,
        )?;

        let resolved_profile =
            resolve_effective_profile(workspace.path(), PermissionProfile::ReadOnly)?;
        assert_eq!(resolved_profile, PermissionProfile::FullAccess);

        let runtime_policy =
            resolve_effective_runtime_policy(workspace.path(), PermissionProfile::ReadOnly)?;
        assert_eq!(
            runtime_policy,
            map_profile_to_runtime_policy(PermissionProfile::FullAccess)
        );

        let network_decision =
            resolve_effective_network_decision(workspace.path(), PermissionProfile::ReadOnly)?;
        assert_eq!(network_decision, PolicyDecision::Allow);

        Ok(())
    }

    #[test]
    fn resolve_effective_profile_falls_back_without_project_file() -> anyhow::Result<()> {
        let workspace = TempDir::new()?;

        let resolved_profile =
            resolve_effective_profile(workspace.path(), PermissionProfile::ReadWriteWithApproval)?;
        assert_eq!(resolved_profile, PermissionProfile::ReadWriteWithApproval);

        Ok(())
    }

    #[test]
    fn load_project_policy_rejects_unknown_fields() -> anyhow::Result<()> {
        let workspace = TempDir::new()?;
        write_project_policy_file(
            &workspace,
            r#"
schema_version = 1
permission_profile = "read_only"
unexpected_flag = true
"#,
        )?;

        let loaded = load_project_policy(workspace.path());
        assert!(matches!(
            loaded,
            Err(ProjectPolicyConfigError::ParseFailed { .. })
        ));

        Ok(())
    }

    #[test]
    fn load_project_policy_rejects_unsupported_schema_version() -> anyhow::Result<()> {
        let workspace = TempDir::new()?;
        write_project_policy_file(
            &workspace,
            r#"
schema_version = 2
permission_profile = "read_only"
"#,
        )?;

        let loaded = load_project_policy(workspace.path());
        assert!(matches!(
            loaded,
            Err(ProjectPolicyConfigError::UnsupportedSchemaVersion {
                expected: 1,
                found: 2,
                ..
            })
        ));

        Ok(())
    }
}
