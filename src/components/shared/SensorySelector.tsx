/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 通用的感官性状多选悬浮面板组件：点击输入框弹出气泡多选面板，支持点击外部自动收起。供台账样式一（总表）与样式二（流水）共用。
 */

import React from "react";

/**
 * @description SensorySelector 组件入参接口
 */
interface SensorySelectorProps {
  /** 当前选中值，多个性状以顿号分隔 */
  value: string;
  /** 值变更回调 */
  onChange: (val: string) => void;
  /** 是否禁用（非录入状态下为只读展示） */
  disabled?: boolean;
  /** 禁用态占位文案（用于兼容台账样式一/样式二的视觉差异，默认对应样式一） */
  disabledPlaceholder?: string;
  /** 禁用态输入框的样式类（用于兼容台账样式一/样式二的视觉差异，默认对应样式一） */
  disabledClassName?: string;
  /** 聚焦态边框色样式类（用于兼容台账样式一/样式二的视觉差异，默认对应样式一） */
  focusBorderClassName?: string;
}

export function SensorySelector({
  value,
  onChange,
  disabled,
  disabledPlaceholder = "未开启录入",
  disabledClassName = "disabled:bg-slate-50",
  focusBorderClassName = "focus:border-emerald-400"
}: SensorySelectorProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  /** 备选感官性状字典项 */
  const options = [
    "包装完整", "米粒饱满", "新鲜", "有光泽", "味正", "颜色好",
    "肉鲜", "新鲜光滑", "鲜", "嫩", "绿", "色泽鲜亮", "形状饱满",
    "光泽度好", "颜色鲜艳"
  ];

  /** 解析当前逗号或顿号分割的选中值 */
  const selectedValues = value ? value.split("、").filter(Boolean) : [];

  const handleToggle = (opt: string) => {
    let next: string[];
    if (selectedValues.includes(opt)) {
      next = selectedValues.filter(v => v !== opt);
    } else {
      next = [...selectedValues, opt];
    }
    onChange(next.join("、"));
  };

  React.useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative inline-block w-full">
      <input
        type="text"
        value={value}
        onClick={() => !disabled && setIsOpen(true)}
        placeholder={disabled ? disabledPlaceholder : "合格 (点击选择)"}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full bg-white ${disabledClassName} disabled:text-slate-400 border border-slate-200 px-2 py-1 rounded outline-none cursor-pointer text-xs ${focusBorderClassName}`}
      />
      {isOpen && !disabled && (
        <div className="absolute left-0 mt-1 p-2.5 bg-white border border-slate-200 rounded-lg shadow-lg z-50 w-64 max-h-48 overflow-y-auto">
          <div className="text-[10px] text-slate-400 font-bold mb-2 pb-1 border-b border-slate-100 flex justify-between items-center select-none">
            <span>感官性状 (多选)</span>
            <button
              type="button"
              onClick={() => onChange("")}
              className="text-rose-500 hover:text-rose-600 font-black cursor-pointer text-[10px]"
            >
              清空
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {options.map((opt) => {
              const isSelected = selectedValues.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleToggle(opt)}
                  className={`text-[10px] px-2 py-0.5 rounded border transition-all cursor-pointer ${
                    isSelected
                      ? "bg-emerald-500 border-emerald-500 text-white font-bold"
                      : "bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-600"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
