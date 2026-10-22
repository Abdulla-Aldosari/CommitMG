// Tests for the source badge of a VS Code setting: what it says, and when a
// click may copy the setting to the workspace.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { settingBadgeView } from "../src/webview/settingBadge";

describe("settingBadgeView", () => {
  it("shows nothing for a source it does not know", () => {
    assert.equal(settingBadgeView("somewhere", true), null);
    assert.equal(settingBadgeView("", true), null);
  });

  it("makes the User badge copy to the workspace when there is one", () => {
    const view = settingBadgeView("user", true);
    assert.equal(view?.label, "User");
    assert.equal(view?.clickable, true);
    assert.equal(view?.footer, "Click to copy to this workspace.");
    assert.equal(view?.tooltip, "Source: user settings.<br>Reset removes it there.<br>Changing it affects all workspaces.");
    assert.equal(view?.resettable, true);
  });

  it("makes the Default badge set the setting in the workspace when there is one", () => {
    const view = settingBadgeView("default", true);
    assert.equal(view?.label, "Default");
    assert.equal(view?.clickable, true);
    assert.equal(view?.footer, "Click to set it in this workspace only.");
    assert.match(view?.tooltip ?? "", /affect all workspaces/);
    assert.equal(view?.resettable, false);
    assert.equal(view?.resetHint, null);
  });

  it("keeps the Workspace badge as plain text", () => {
    const view = settingBadgeView("workspace", true);
    assert.equal(view?.label, "Workspace");
    assert.equal(view?.clickable, false);
    assert.equal(view?.footer, null);
    assert.equal(view?.resettable, true);
  });

  it("keeps User and Default as text, and explains why, without a workspace", () => {
    for (const source of ["user", "default"]) {
      const view = settingBadgeView(source, false);
      assert.equal(view?.clickable, false, source);
      assert.equal(view?.footer, "Open a folder or workspace to set it per workspace.", source);
    }
  });

  it("treats a missing workspace flag as no workspace", () => {
    for (const source of ["user", "default"]) {
      assert.equal(settingBadgeView(source, undefined)?.clickable, false, source);
    }
  });

  it("keeps the Workspace badge text the same with or without a workspace", () => {
    assert.deepEqual(settingBadgeView("workspace", false), settingBadgeView("workspace", true));
  });
});
