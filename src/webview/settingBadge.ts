// The source badge of a VS Code setting: what it says, what its tooltip
// says, and whether clicking it copies the setting to the workspace. Pure,
// so every case is tested; the setting row only draws the result.

export type BadgeSource = "workspace" | "user" | "default";

export interface SettingBadgeView {
  label: string;
  // The tooltip body; "<br>" separates its lines.
  tooltip: string;
  // The tooltip footer, or null for none.
  footer: string | null;
  // True when clicking the badge copies the setting to the workspace.
  clickable: boolean;
  // Reset shows only for a setting that is stored somewhere.
  resettable: boolean;
  // What Reset removes, for its tooltip, or null when there is no Reset.
  resetHint: string | null;
}

const NO_WORKSPACE_LINE = "Open a folder or workspace to set it per workspace.";

// hasWorkspace is whether the window has a folder or workspace. It may be
// undefined when the host did not send it; that counts as no workspace, so a
// badge never offers an action that cannot run.
export function settingBadgeView(source: string, hasWorkspace: boolean | undefined): SettingBadgeView | null {
  const canCopy = hasWorkspace === true;
  switch (source) {
    case "user":
      return {
        label: "User",
        tooltip: `Source: user settings.<br>Reset removes it there.<br>Changing it affects all workspaces.`,
        footer: canCopy ? "Click to copy to this workspace." : NO_WORKSPACE_LINE,
        clickable: canCopy,
        resettable: true,
        resetHint: "Removes it from your user settings, so the default applies.",
      };
    case "workspace":
      return {
        label: "Workspace",
        tooltip: `Source: workspace settings.<br>They override your user settings.<br>Reset removes it there.`,
        footer: null,
        clickable: false,
        resettable: true,
        resetHint: "Removes it from this workspace, so your user setting (or the default) applies.",
      };
    case "default":
      return {
        label: "Default",
        tooltip: `Source: default.<br>Changes here are saved in your user settings<br>and affect all workspaces.`,
        footer: canCopy ? "Click to set it in this workspace only." : NO_WORKSPACE_LINE,
        clickable: canCopy,
        resettable: false,
        resetHint: null,
      };
    default:
      return null;
  }
}
