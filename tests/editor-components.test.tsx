import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { ColorPicker, CommitNumberInput } from "../site/editor/main";

describe("editor form components", () => {
  it("commits an exact integer when the number field loses focus", () => {
    const onCommit = vi.fn();
    render(<CommitNumberInput value={2} onCommit={onCommit} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.input(input, { target: { value: "-7" } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(-7);
  });

  it("exposes the four fixture colors as pressed-state buttons", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="red" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "red" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "blue" }));
    expect(onChange).toHaveBeenCalledWith("blue");
  });
});
