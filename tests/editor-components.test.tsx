import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { ColorPicker, CommitNumberInput, elevationColorLevel } from "../site/editor/main";

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

  it("maps cell elevations onto a color scale capped at level five", () => {
    expect(elevationColorLevel({ type: "flat", elevation: -2 })).toBe(0);
    expect(elevationColorLevel({ type: "flat", elevation: 2 })).toBe(2);
    expect(elevationColorLevel({ type: "ramp", lowDirection: "north", lowElevation: 3 })).toBe(3);
    expect(elevationColorLevel({ type: "flat", elevation: 5 })).toBe(5);
    expect(elevationColorLevel({ type: "flat", elevation: 12 })).toBe(5);
  });
});
