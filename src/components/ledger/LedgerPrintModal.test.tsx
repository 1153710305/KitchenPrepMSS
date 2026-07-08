/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description LedgerPrintModal（台账打印二级分类勾选弹窗）组件测试：关闭态不渲染、[V5.48.0] 无数据大类禁用勾选与"全选"仅选中有数据大类的回归测试、
 * 勾选/清空交互、预览按钮在未选中任何大类时禁用、关闭回调。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LedgerPrintModal } from "./LedgerPrintModal.tsx";
import { FoodCategory } from "../../types/types.ts";

const baseProps = {
  isOpen: true,
  setPrintPreviewStyle: vi.fn(),
  onClose: vi.fn()
};

describe("LedgerPrintModal", () => {
  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <LedgerPrintModal
        {...baseProps}
        isOpen={false}
        selectedPrintCategories={[]}
        setSelectedPrintCategories={vi.fn()}
        printableCategories={new Set()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the modal with all six category checkboxes when open", () => {
    render(
      <LedgerPrintModal
        {...baseProps}
        selectedPrintCategories={[]}
        setSelectedPrintCategories={vi.fn()}
        printableCategories={new Set(Object.values(FoodCategory))}
      />
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
  });

  describe("REGRESSION [V5.48.0]: disabling categories with no data", () => {
    it("disables the checkbox and labels it (无数据) for a category not in printableCategories", () => {
      render(
        <LedgerPrintModal
          {...baseProps}
          selectedPrintCategories={[]}
          setSelectedPrintCategories={vi.fn()}
          printableCategories={new Set(["VEGETABLE"])}
        />
      );

      const meatCheckbox = screen.getByRole("checkbox", { name: /肉类（无数据）/ });
      expect(meatCheckbox).toBeDisabled();
    });

    it("leaves a printable category's checkbox enabled and unlabeled", () => {
      render(
        <LedgerPrintModal
          {...baseProps}
          selectedPrintCategories={[]}
          setSelectedPrintCategories={vi.fn()}
          printableCategories={new Set(["VEGETABLE"])}
        />
      );

      const vegetableCheckbox = screen.getByRole("checkbox", { name: "蔬菜" });
      expect(vegetableCheckbox).not.toBeDisabled();
    });

    it("'全选' only selects the categories that actually have data", async () => {
      const user = userEvent.setup();
      const setSelectedPrintCategories = vi.fn();
      render(
        <LedgerPrintModal
          {...baseProps}
          selectedPrintCategories={[]}
          setSelectedPrintCategories={setSelectedPrintCategories}
          printableCategories={new Set(["VEGETABLE", "LOW_CONSUMP"])}
        />
      );

      await user.click(screen.getByRole("button", { name: "全选" }));

      expect(setSelectedPrintCategories).toHaveBeenCalledWith(["VEGETABLE", "LOW_CONSUMP"]);
    });
  });

  it("'清空' clears the selection entirely", async () => {
    const user = userEvent.setup();
    const setSelectedPrintCategories = vi.fn();
    render(
      <LedgerPrintModal
        {...baseProps}
        selectedPrintCategories={["VEGETABLE"]}
        setSelectedPrintCategories={setSelectedPrintCategories}
        printableCategories={new Set(["VEGETABLE"])}
      />
    );

    await user.click(screen.getByRole("button", { name: "清空" }));

    expect(setSelectedPrintCategories).toHaveBeenCalledWith([]);
  });

  it("toggles an individual printable category on click, adding it to the selection", async () => {
    const user = userEvent.setup();
    const setSelectedPrintCategories = vi.fn();
    render(
      <LedgerPrintModal
        {...baseProps}
        selectedPrintCategories={[]}
        setSelectedPrintCategories={setSelectedPrintCategories}
        printableCategories={new Set(["VEGETABLE"])}
      />
    );

    await user.click(screen.getByRole("checkbox", { name: "蔬菜" }));

    expect(setSelectedPrintCategories).toHaveBeenCalledWith(["VEGETABLE"]);
  });

  it("toggles an already-selected category off on click", async () => {
    const user = userEvent.setup();
    const setSelectedPrintCategories = vi.fn();
    render(
      <LedgerPrintModal
        {...baseProps}
        selectedPrintCategories={["VEGETABLE"]}
        setSelectedPrintCategories={setSelectedPrintCategories}
        printableCategories={new Set(["VEGETABLE"])}
      />
    );

    await user.click(screen.getByRole("checkbox", { name: "蔬菜" }));

    expect(setSelectedPrintCategories).toHaveBeenCalledWith([]);
  });

  it("disables the preview button when no category is selected", () => {
    render(
      <LedgerPrintModal
        {...baseProps}
        selectedPrintCategories={[]}
        setSelectedPrintCategories={vi.fn()}
        printableCategories={new Set(["VEGETABLE"])}
      />
    );
    expect(screen.getByRole("button", { name: "预览登记总表" })).toBeDisabled();
  });

  it("closes and switches to style1 preview when the preview button is clicked with a selection", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const setPrintPreviewStyle = vi.fn();
    render(
      <LedgerPrintModal
        {...baseProps}
        onClose={onClose}
        setPrintPreviewStyle={setPrintPreviewStyle}
        selectedPrintCategories={["VEGETABLE"]}
        setSelectedPrintCategories={vi.fn()}
        printableCategories={new Set(["VEGETABLE"])}
      />
    );

    await user.click(screen.getByRole("button", { name: "预览登记总表" }));

    expect(onClose).toHaveBeenCalled();
    expect(setPrintPreviewStyle).toHaveBeenCalledWith("style1");
  });

  it("calls onClose when the cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <LedgerPrintModal
        {...baseProps}
        onClose={onClose}
        selectedPrintCategories={[]}
        setSelectedPrintCategories={vi.fn()}
        printableCategories={new Set()}
      />
    );

    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(onClose).toHaveBeenCalled();
  });
});
