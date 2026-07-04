/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description HelperSelect（台账常用字段下拉选择器）组件测试：编辑态渲染下拉框、非编辑态渲染只读输入框（含 [V5.46.0] 禁用态宽度类名回归测试）、
 * 值不在候选项内时合并展示、onChange 回调、占位文案。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelperSelect } from "./HelperSelect.tsx";

describe("HelperSelect", () => {
  describe("disabled (read-only) state", () => {
    it("renders a disabled text input showing the current value", () => {
      render(<HelperSelect value="合作基地直供" options={[]} onChange={vi.fn()} disabled placeholder="未开启录入" />);

      const input = screen.getByDisplayValue("合作基地直供") as HTMLInputElement;
      expect(input.tagName).toBe("INPUT");
      expect(input.disabled).toBe(true);
    });

    it("shows the placeholder when the value is empty", () => {
      render(<HelperSelect value="" options={[]} onChange={vi.fn()} disabled placeholder="未开启录入" />);
      expect(screen.getByPlaceholderText("未开启录入")).toBeInTheDocument();
    });

    it("REGRESSION [V5.46.0]: forwards the className prop (width) to the disabled input instead of hardcoding w-full", () => {
      render(<HelperSelect value="张采购" options={[]} onChange={vi.fn()} disabled placeholder="未开启录入" className="w-48" />);

      const input = screen.getByDisplayValue("张采购");
      expect(input.className).toContain("w-48");
      expect(input.className).not.toContain("w-full");
    });

    it("applies the disabledClassName styling passed in for style2 (flow view) usage", () => {
      render(
        <HelperSelect
          value="张采购"
          options={[]}
          onChange={vi.fn()}
          disabled
          placeholder="锁定"
          disabledClassName="bg-white text-slate-300"
        />
      );
      const input = screen.getByDisplayValue("张采购");
      expect(input.className).toContain("bg-white");
      expect(input.className).toContain("text-slate-300");
    });
  });

  describe("editable state", () => {
    it("renders a select populated with the given options", () => {
      render(
        <HelperSelect
          value=""
          options={["张采购", "李采购"]}
          onChange={vi.fn()}
          disabled={false}
          placeholder="未开启录入"
        />
      );

      expect(screen.getByRole("combobox")).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "张采购" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "李采购" })).toBeInTheDocument();
    });

    it("fires onChange with the selected value", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <HelperSelect value="" options={["张采购", "李采购"]} onChange={onChange} disabled={false} placeholder="x" />
      );

      await user.selectOptions(screen.getByRole("combobox"), "李采购");

      expect(onChange).toHaveBeenCalledWith("李采购");
    });

    it("merges a value not present in the dictionary options into the list so it is not silently lost", () => {
      render(
        <HelperSelect
          value="历史遗留值"
          options={["张采购", "李采购"]}
          onChange={vi.fn()}
          disabled={false}
          placeholder="x"
        />
      );

      expect(screen.getByRole("option", { name: "历史遗留值" })).toBeInTheDocument();
      expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("历史遗留值");
    });

    it("does not duplicate a value that is already present in the dictionary options", () => {
      render(
        <HelperSelect value="张采购" options={["张采购", "李采购"]} onChange={vi.fn()} disabled={false} placeholder="x" />
      );

      expect(screen.getAllByRole("option", { name: "张采购" })).toHaveLength(1);
    });
  });
});
