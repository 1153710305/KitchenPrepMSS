/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description SensorySelector（感官性状多选悬浮面板）组件测试：候选项来自 LedgerService 可配置字典而非硬编码数组、
 * 点击展开/收起面板、多选切换、清空、禁用态展示。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SensorySelector } from "./SensorySelector.tsx";
import { LedgerService } from "../../services/ledgerStore.ts";

describe("SensorySelector", () => {
  beforeEach(() => {
    vi.spyOn(LedgerService, "getHelperDict").mockReturnValue({
      suppliers: [],
      buyers: [],
      inspectors: [],
      keepers: [],
      outHandlers: [],
      outRecipients: [],
      sensoryOptions: ["新鲜", "合格", "不合格"],
      shelfLifeOptions: []
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("[V5.68.0] renders candidate options sourced from LedgerService.getHelperDict().sensoryOptions", async () => {
    const user = userEvent.setup();
    render(<SensorySelector value="" onChange={vi.fn()} disabled={false} />);

    await user.click(screen.getByPlaceholderText("合格 (点击选择)"));

    expect(screen.getByRole("button", { name: "新鲜" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "合格" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "不合格" })).toBeInTheDocument();
  });

  it("toggles an option into the selected value, joined with 、", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SensorySelector value="" onChange={onChange} disabled={false} />);

    await user.click(screen.getByPlaceholderText("合格 (点击选择)"));
    await user.click(screen.getByRole("button", { name: "新鲜" }));

    expect(onChange).toHaveBeenCalledWith("新鲜");
  });

  it("removes an already-selected option on second click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SensorySelector value="新鲜、合格" onChange={onChange} disabled={false} />);

    await user.click(screen.getByDisplayValue("新鲜、合格"));
    await user.click(screen.getByRole("button", { name: "新鲜" }));

    expect(onChange).toHaveBeenCalledWith("合格");
  });

  it("clears the value entirely when the 清空 button is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SensorySelector value="新鲜、合格" onChange={onChange} disabled={false} />);

    await user.click(screen.getByDisplayValue("新鲜、合格"));
    await user.click(screen.getByRole("button", { name: "清空" }));

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("closes the popup when clicking outside the component", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <SensorySelector value="" onChange={vi.fn()} disabled={false} />
        <div data-testid="outside">outside</div>
      </div>
    );

    await user.click(screen.getByPlaceholderText("合格 (点击选择)"));
    expect(screen.getByRole("button", { name: "新鲜" })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside"));

    expect(screen.queryByRole("button", { name: "新鲜" })).not.toBeInTheDocument();
  });

  it("shows the disabled placeholder and does not open the popup when disabled", async () => {
    const user = userEvent.setup();
    render(<SensorySelector value="" onChange={vi.fn()} disabled disabledPlaceholder="未开启录入" />);

    const input = screen.getByPlaceholderText("未开启录入");
    expect(input).toBeDisabled();

    await user.click(input);
    expect(screen.queryByRole("button", { name: "新鲜" })).not.toBeInTheDocument();
  });
});
