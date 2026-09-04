import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PackagesCard } from "./PackagesCard";
import type { DraftPackage } from "../api/client";

beforeAll(() => {
  // jsdom has no object URLs, and the thumbnails ask for one per photo.
  URL.createObjectURL = vi.fn(() => "blob:mock");
});

function imageFile(name: string) {
  return new File(["x"], name, { type: "image/png" });
}

function Harness({ enabled = true, initial = [] as DraftPackage[] }) {
  const [packages, setPackages] = useState<DraftPackage[]>(initial);
  return <PackagesCard enabled={enabled} packages={packages} onChange={setPackages} />;
}

async function addPhotos(user: ReturnType<typeof userEvent.setup>, count: number) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(
    input,
    Array.from({ length: count }, (_, i) => imageFile(`photo-${i}.png`))
  );
}

const saveButton = () => screen.getByRole("button", { name: "שמירת חבילה והוספת הבאה" });

describe("PackagesCard", () => {
  it("is locked until the reference validates", () => {
    render(<Harness enabled={false} />);

    expect(screen.getByText("אמתו את מספר האסמכתא כדי להתחיל להוסיף חבילות.")).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeDisabled();
  });

  it("keeps save disabled until four valid photos are attached", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(saveButton()).toBeDisabled();

    await addPhotos(user, 3);
    expect(screen.getByText(/3 מתוך 4\+ מינימום/)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    await addPhotos(user, 1);
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });

  it("flags a non-image file and does not count it toward the minimum", async () => {
    // applyAccept: false because accept="image/*" is only a picker hint — a
    // drag-drop or an "All Files" picker can still hand us a non-image, which
    // is exactly what this client-side check exists for. Without this,
    // user-event filters the file out before the component ever sees it.
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, [
      imageFile("a.png"),
      imageFile("b.png"),
      imageFile("c.png"),
      new File(["x"], "notes.txt", { type: "text/plain" }),
    ]);

    expect(screen.getByText(/3 מתוך 4\+ מינימום/)).toBeInTheDocument();
    expect(screen.getByTitle("לא קובץ תמונה")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("saves a package and advances to the next number", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await addPhotos(user, 4);
    await user.click(saveButton());

    expect(screen.getByText("חבילה 1")).toBeInTheDocument();
    expect(screen.getByText("1 חבילות נוספו")).toBeInTheDocument();
    // The chip now tells the employee to write "2" on the next box.
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("skips the deleted package's number instead of reusing it", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    for (let i = 0; i < 3; i++) {
      await addPhotos(user, 4);
      await user.click(saveButton());
    }
    expect(screen.getByText("חבילה 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "מחיקת חבילה 2" }));
    expect(screen.queryByText("חבילה 2")).not.toBeInTheDocument();

    // Box 3 already exists and is marked "3", so the next box must be 4.
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("asks before discarding photos already picked for the next box", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await addPhotos(user, 4);
    await user.click(saveButton());

    // Photos picked for box 2, then a mis-click on the saved package 1.
    await addPhotos(user, 2);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(screen.getByText("חבילה 1"));

    expect(confirmSpy).toHaveBeenCalled();
    // Declined, so the draft survives and package 1 did not open for editing.
    expect(screen.getByText(/2 מתוך 4\+ מינימום/)).toBeInTheDocument();
    expect(screen.queryByText("חבילה 1 — בעריכה")).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("reopens a saved package's photos for editing and writes them back", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await addPhotos(user, 4);
    await user.click(saveButton());
    await user.click(screen.getByText("חבילה 1"));

    expect(screen.getByText("חבילה 1 — בעריכה")).toBeInTheDocument();
    expect(screen.getByText(/4 מתוך 4\+ מינימום/)).toBeInTheDocument();

    await addPhotos(user, 1);
    await user.click(screen.getByRole("button", { name: "עדכון חבילה" }));

    expect(screen.getByText("5 תמונות")).toBeInTheDocument();
    // Editing must not renumber the box.
    expect(screen.getByText("חבילה 1")).toBeInTheDocument();
    expect(screen.getByText("1 חבילות נוספו")).toBeInTheDocument();
  });
});
