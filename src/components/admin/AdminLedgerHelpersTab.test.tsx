/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description AdminLedgerHelpersTab（管理后台"台账人员与供货商"Tab）组件测试：[V5.68.0] 新增的"感官性状候选项""保质期候选项"
 * 两栏的添加/删除/去重逻辑，以及既有六大人员字典栏目的回车快速新增行为。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminLedgerHelpersTab } from "./AdminLedgerHelpersTab.tsx";
import { LedgerService } from "../../services/ledgerStore.ts";

const baseDict = {
  suppliers: [] as string[],
  buyers: [] as string[],
  inspectors: [] as string[],
  keepers: [] as string[],
  outHandlers: [] as string[],
  outRecipients: [] as string[],
  sensoryOptions: ["新鲜", "合格"],
  shelfLifeOptions: ["2天", "15天"]
};

describe("AdminLedgerHelpersTab", () => {
  beforeEach(() => {
    vi.spyOn(LedgerService, "getHelperDict").mockReturnValue({ ...baseDict });
    vi.spyOn(LedgerService, "updateHelperDict").mockImplementation(() => {});
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("[V5.68.0] renders the 感官性状候选项/保质期候选项 cards alongside the existing six helper lists", () => {
    render(<AdminLedgerHelpersTab />);

    expect(screen.getByText("感官性状候选项")).toBeInTheDocument();
    expect(screen.getByText("保质期候选项")).toBeInTheDocument();
    expect(screen.getByText("新鲜")).toBeInTheDocument();
    expect(screen.getByText("2天")).toBeInTheDocument();
  });

  it("[V5.68.0] adds a new sensory option via the add button and calls updateHelperDict with the appended list", async () => {
    const user = userEvent.setup();
    render(<AdminLedgerHelpersTab />);

    const input = screen.getByPlaceholderText("例如: 新鲜");
    await user.type(input, "有光泽");
    const addButton = input.parentElement!.querySelector('button[title="添加新项"]')!;
    await user.click(addButton);

    expect(LedgerService.updateHelperDict).toHaveBeenCalledWith(
      expect.objectContaining({ sensoryOptions: ["新鲜", "合格", "有光泽"] })
    );
  });

  it("[V5.68.0] adds a new shelf-life option via Enter key", async () => {
    const user = userEvent.setup();
    render(<AdminLedgerHelpersTab />);

    const input = screen.getByPlaceholderText("例如: 3个月");
    await user.type(input, "1个月{Enter}");

    expect(LedgerService.updateHelperDict).toHaveBeenCalledWith(
      expect.objectContaining({ shelfLifeOptions: ["2天", "15天", "1个月"] })
    );
  });

  it("[V5.68.0] rejects a duplicate sensory option and does not call updateHelperDict", async () => {
    const user = userEvent.setup();
    render(<AdminLedgerHelpersTab />);

    const input = screen.getByPlaceholderText("例如: 新鲜");
    await user.type(input, "新鲜");
    const addButton = input.parentElement!.querySelector('button[title="添加新项"]')!;
    await user.click(addButton);

    expect(window.alert).toHaveBeenCalledWith("该项目已存在，请勿重复添加！");
    expect(LedgerService.updateHelperDict).not.toHaveBeenCalled();
  });

  it("[V5.68.0] deletes a shelf-life option", async () => {
    const user = userEvent.setup();
    render(<AdminLedgerHelpersTab />);

    await user.click(screen.getByTitle("删除 2天"));

    expect(LedgerService.updateHelperDict).toHaveBeenCalledWith(
      expect.objectContaining({ shelfLifeOptions: ["15天"] })
    );
  });
});
