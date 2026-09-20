import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      title="התמונות שטרם נשמרו יימחקו"
      detail="פתיחת חבילה 1 תחליף את התמונות שנבחרו."
      confirmLabel="מחיקת התמונות"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />
  );
  return { onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("names itself by its title and describes itself by its detail", () => {
    renderDialog();

    const dialog = screen.getByRole("alertdialog", { name: "התמונות שטרם נשמרו יימחקו" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("פתיחת חבילה 1 תחליף את התמונות שנבחרו.");
  });

  it("focuses the cancelling button, not the destructive one", () => {
    renderDialog();

    // A stray Enter should not discard work that exists only in memory.
    expect(screen.getByRole("button", { name: "ביטול" })).toHaveFocus();
  });

  it("cancels on Escape", async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = renderDialog();

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keeps Tab inside the dialog", async () => {
    const user = userEvent.setup();
    renderDialog();

    const cancel = screen.getByRole("button", { name: "ביטול" });
    const confirm = screen.getByRole("button", { name: "מחיקת התמונות" });

    await user.tab();
    expect(confirm).toHaveFocus();
    // Past the last control, focus comes back round rather than reaching the
    // page the user has been asked to stop interacting with.
    await user.tab();
    expect(cancel).toHaveFocus();
  });

  it("returns focus to whatever opened it", async () => {
    render(<button type="button">חבילה 1</button>);
    const opener = screen.getByRole("button", { name: "חבילה 1" });
    opener.focus();

    const { unmount } = render(
      <ConfirmDialog title="כותרת" confirmLabel="אישור" onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "ביטול" })).toHaveFocus();

    unmount();

    await vi.waitFor(() => expect(opener).toHaveFocus());
  });

  it("cancels when the backdrop is clicked, and not the panel", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog();

    await user.click(screen.getByRole("alertdialog"));
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(document.querySelector(".dialog-backdrop") as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
