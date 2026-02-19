use serde::Deserialize;
use serde::Serialize;

pub const POLICY_CONTRACT_VERSION: &str = "v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionKind {
    ReadFile,
    WriteFile,
    ExecuteCommand,
    ApplyPatch,
    NetworkAccess,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyDecision {
    Allow,
    RequireApproval,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionProfile {
    ReadOnly,
    ReadWriteWithApproval,
    FullAccess,
}

impl PermissionProfile {
    pub fn decision_for(self, action: ActionKind) -> PolicyDecision {
        match self {
            Self::ReadOnly => match action {
                ActionKind::ReadFile => PolicyDecision::Allow,
                ActionKind::WriteFile
                | ActionKind::ExecuteCommand
                | ActionKind::ApplyPatch
                | ActionKind::NetworkAccess => PolicyDecision::Deny,
            },
            Self::ReadWriteWithApproval => match action {
                ActionKind::ReadFile => PolicyDecision::Allow,
                ActionKind::WriteFile
                | ActionKind::ExecuteCommand
                | ActionKind::ApplyPatch
                | ActionKind::NetworkAccess => PolicyDecision::RequireApproval,
            },
            Self::FullAccess => PolicyDecision::Allow,
        }
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::ActionKind;
    use super::PermissionProfile;
    use super::PolicyDecision;

    fn collect_decisions(profile: PermissionProfile) -> Vec<(ActionKind, PolicyDecision)> {
        let actions = [
            ActionKind::ReadFile,
            ActionKind::WriteFile,
            ActionKind::ExecuteCommand,
            ActionKind::ApplyPatch,
            ActionKind::NetworkAccess,
        ];

        actions
            .iter()
            .copied()
            .map(|action| (action, profile.decision_for(action)))
            .collect()
    }

    #[test]
    fn read_only_profile_matches_contract() {
        let expected = vec![
            (ActionKind::ReadFile, PolicyDecision::Allow),
            (ActionKind::WriteFile, PolicyDecision::Deny),
            (ActionKind::ExecuteCommand, PolicyDecision::Deny),
            (ActionKind::ApplyPatch, PolicyDecision::Deny),
            (ActionKind::NetworkAccess, PolicyDecision::Deny),
        ];

        assert_eq!(collect_decisions(PermissionProfile::ReadOnly), expected);
    }

    #[test]
    fn read_write_with_approval_profile_matches_contract() {
        let expected = vec![
            (ActionKind::ReadFile, PolicyDecision::Allow),
            (ActionKind::WriteFile, PolicyDecision::RequireApproval),
            (ActionKind::ExecuteCommand, PolicyDecision::RequireApproval),
            (ActionKind::ApplyPatch, PolicyDecision::RequireApproval),
            (ActionKind::NetworkAccess, PolicyDecision::RequireApproval),
        ];

        assert_eq!(
            collect_decisions(PermissionProfile::ReadWriteWithApproval),
            expected
        );
    }

    #[test]
    fn full_access_profile_matches_contract() {
        let expected = vec![
            (ActionKind::ReadFile, PolicyDecision::Allow),
            (ActionKind::WriteFile, PolicyDecision::Allow),
            (ActionKind::ExecuteCommand, PolicyDecision::Allow),
            (ActionKind::ApplyPatch, PolicyDecision::Allow),
            (ActionKind::NetworkAccess, PolicyDecision::Allow),
        ];

        assert_eq!(collect_decisions(PermissionProfile::FullAccess), expected);
    }
}
