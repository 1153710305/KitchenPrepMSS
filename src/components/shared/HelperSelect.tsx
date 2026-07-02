/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 通用的台账常用字段下拉选择器：非编辑态展示为只读输入框，编辑态展示为下拉选择（可保留字典外的历史值）。供台账样式一（总表）与样式二（流水）共用。
 */

import React from "react";

/**
 * @description HelperSelect 组件入参接口
 */
interface HelperSelectProps {
  /** 当前选中的值 */
  value: string;
  /** 候选选项列表（来自后台常用字典配置） */
  options: string[];
  /** 值变更回调 */
  onChange: (val: string) => void;
  /** 是否禁用（非录入状态下为只读展示） */
  disabled?: boolean;
  /** 占位文案 */
  placeholder: string;
  /** 下拉选择框的宽度等样式类 */
  className?: string;
  /** 禁用态输入框的样式类（用于兼容台账样式一/样式二的视觉差异，默认对应样式一） */
  disabledClassName?: string;
  /** 聚焦态边框色样式类（用于兼容台账样式一/样式二的视觉差异，默认对应样式一） */
  focusBorderClassName?: string;
}

export function HelperSelect({
  value,
  options,
  onChange,
  disabled,
  placeholder,
  className = "w-28",
  disabledClassName = "bg-slate-50 text-slate-400",
  focusBorderClassName = "focus:border-emerald-400"
}: HelperSelectProps) {
  if (disabled) {
    return (
      <input
        type="text"
        value={value || ""}
        placeholder={placeholder}
        disabled={true}
        className={`${disabledClassName} border border-slate-200 px-2 py-1 rounded outline-none w-full`}
      />
    );
  }
  // 如果值存在但不在字典候选项里，则合并到首位展示以防止已有数值丢失
  const allOpts = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className={`bg-white border border-slate-200 px-2 py-1 rounded outline-none text-xs cursor-pointer ${focusBorderClassName} ${className}`}
    >
      <option value="">-- 选择 --</option>
      {allOpts.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}
