/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 通用的可搜索下拉选择器组件：支持拼音全拼/首字母模糊匹配候选项，点击展开悬浮联想面板、点击外部自动收起，供台账新增原料等表单复用。
 */

import { useState, useRef, useEffect } from "react";
import { Search, ChevronDown } from "lucide-react";

/**
 * @description 单个下拉选项结构接口
 */
export interface SelectOption {
  /** 选项值，通常是原料的名称 */
  value: string;
  /** 选项展示的文本标签 */
  label: string;
  /** 可选：对应原料的默认单位 */
  unit?: string;
  /** 可选：对应原料的所属大类 */
  category?: string;
}

/**
 * @description 搜索下拉框组件入参协议
 */
interface SearchableSelectProps {
  /** 可选选项列表 */
  options: SelectOption[];
  /** 当前选中的值 */
  value: string;
  /** 选中值变化时的回调函数 */
  onChange: (value: string, selectedOpt?: SelectOption) => void;
  /** 输入框为空时的占位符提示 */
  placeholder?: string;
  /** 自定义 CSS 样式类名 */
  className?: string;
  /** 是否禁用组件 */
  disabled?: boolean;
}

import { matchPinyin } from "../../utils.ts";

/**
 * @description 支持拼音/中文输入实时过滤、可手动录入未知原料自动过滤的安全下拉选择器组件
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "请选择或输入内容进行搜索",
  className = "",
  disabled = false
}: SearchableSelectProps) {
  /** 下拉浮窗是否开启的状态标识 */
  const [isOpen, setIsOpen] = useState<boolean>(false);
  /** 下拉框内的模糊搜索输入关键字 */
  const [searchText, setSearchText] = useState<string>("");
  /** 最外层容器的引用，用于点击外部时自动收起下拉框 */
  const containerRef = useRef<HTMLDivElement>(null);

  // 当外部的 value 发生变化时，将显示文本或搜索框重置为对应的 label
  useEffect(() => {
    const matchedOpt = options.find((opt) => opt.value === value);
    if (matchedOpt) {
      setSearchText(matchedOpt.label);
    } else {
      setSearchText(value || "");
    }
  }, [value, options]);

  // 监听全局点击事件，当点击组件外部区域时收起下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        // 如果失焦且没有完全匹配，将输入值复原或提交自定义值
        const matchedOpt = options.find((opt) => opt.label === searchText || opt.value === searchText);
        if (matchedOpt) {
          onChange(matchedOpt.value, matchedOpt);
          setSearchText(matchedOpt.label);
        } else {
          // 允许自定义输入文字（模糊搜索匹配）
          if (searchText.trim()) {
            onChange(searchText.trim());
          } else {
            onChange("");
          }
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [searchText, options, onChange]);

  /**
   * @description 过滤出的选项列表，根据搜索内容进行实时匹配，升级为支持拼音模糊匹配
   */
  const filteredOptions = options.filter((opt) =>
    matchPinyin(opt.label, searchText) ||
    matchPinyin(opt.value, searchText)
  );

  /**
   * @description 处理选中选项的操作
   * @param opt 被选中的选项对象
   */
  const handleSelectOption = (opt: SelectOption) => {
    onChange(opt.value, opt);
    setSearchText(opt.label);
    setIsOpen(false);
  };

  /**
   * @description 处理输入框文字改变的操作
   * @param text 输入的新字符串
   */
  const handleInputChange = (text: string) => {
    setSearchText(text);
    setIsOpen(true);
    // 实时通知上层，以支持边输边匹配
    onChange(text);
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* 触发显示区：内嵌 input 与 chevron 下拉指示针 */}
      <div className="relative flex items-center">
        <input
          type="text"
          value={searchText}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => {
            if (!disabled) setIsOpen(true);
          }}
          disabled={disabled}
          placeholder={placeholder}
          className={`w-full bg-white border border-slate-200 hover:border-slate-300 rounded px-2.5 py-1 text-xs outline-none transition-all pr-8 ${
            disabled ? "bg-slate-50 text-slate-400 cursor-not-allowed" : "text-slate-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/10"
          }`}
        />
        <button
          type="button"
          onClick={() => {
            if (!disabled) setIsOpen(!isOpen);
          }}
          disabled={disabled}
          className="absolute right-1.5 p-1 hover:bg-slate-50 rounded text-slate-400 cursor-pointer"
        >
          <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* 下拉浮沉浮窗选项卡列表 */}
      {isOpen && !disabled && (
        <div className="absolute left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl z-50 divide-y divide-slate-50 scrollbar-thin">
          {/* 搜索提示条 */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50/50 text-[10px] text-slate-400 font-medium">
            <Search size={10} />
            <span>输入文字可自动匹配已有原料</span>
          </div>

          {/* 过滤列表 */}
          {filteredOptions.length === 0 ? (
            <div 
              className="px-3 py-2.5 text-xs text-amber-600 bg-amber-50/10 cursor-pointer hover:bg-amber-50/40"
              onClick={() => {
                if (searchText.trim()) {
                  onChange(searchText.trim());
                  setIsOpen(false);
                }
              }}
            >
              未匹配到已有选项，按回车或点击此处直接录入: <strong className="font-bold text-amber-700">"{searchText}"</strong>
            </div>
          ) : (
            filteredOptions.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelectOption(opt)}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors cursor-pointer ${
                    isSelected ? "bg-emerald-50 text-emerald-700 font-extrabold" : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {opt.category && (
                    <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded shrink-0">
                      {opt.category}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
