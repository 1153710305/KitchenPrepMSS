/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Users, Edit2, Trash2, Sparkles, ShieldAlert, Check, PlusCircle } from "lucide-react";
import { PrepReportService } from "../store.ts";
import { DynamicGroup } from "../types.ts";

interface AdminGroupsTabProps {
  onRefresh?: () => void;
}

// 辅助函数：生成一级受众的唯一识别 Key
const generateUniqueGroupKey = () => "GROUP_" + Math.random().toString(36).substr(2, 6).toUpperCase() + "_" + Math.floor(Math.random() * 100);

/**
 * @description 后台受众群体备选头像/图标 Emoji 库
 */
const EMOJIS = [
  "🏫", "👶", "👦", "🏢", "🍽️", "🍲", 
  "🍜", "🍱", "🥖", "👴", "👧", "👩", 
  "👨", "👩‍🍳", "👨‍🍳", "🌾", "🍎", "🥦", 
  "🥩", "🥛", "🎂", "☕", "🥤", "🏡", 
  "🏠", "📈", "🎨", "⚽", "🚀", "🧸"
];

export function AdminGroupsTab({ onRefresh }: AdminGroupsTabProps) {
  const [groups, setGroups] = useState<DynamicGroup[]>(() => PrepReportService.getActiveGroups());

  // Form states
  const [groupKeyInput, setGroupKeyInput] = useState<string>(() => generateUniqueGroupKey());
  const [groupLabelInput, setGroupLabelInput] = useState<string>("");
  const [groupEmojiInput, setGroupEmojiInput] = useState<string>("🏫");
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);

  const handleSaveGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGroupError(null);

    const key = groupKeyInput.trim().toUpperCase();
    const label = groupLabelInput.trim();
    const emoji = groupEmojiInput;

    if (!key || !label) {
      setGroupError("标识Key和人群名称不能为空！");
      return;
    }

    try {
      if (editingGroupKey && editingGroupKey !== key) {
        // 如果标识 Key 被物理移除，这里防御性清除并覆盖老旧分类
        await PrepReportService.deleteGroup(editingGroupKey);
      }
      await PrepReportService.saveGroup(key, label, emoji);

      const freshGroups = PrepReportService.getActiveGroups();
      setGroups(freshGroups);
      setGroupKeyInput(generateUniqueGroupKey());
      setGroupLabelInput("");
      setGroupEmojiInput("🏫");
      setEditingGroupKey(null);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setGroupError(err.message || "保存人群标签失败");
    }
  };

  const handleStartEditGroup = (g: DynamicGroup) => {
    setGroupError(null);
    setEditingGroupKey(g.key);
    setGroupKeyInput(g.key);
    setGroupLabelInput(g.label);
    setGroupEmojiInput(g.emoji || "🍽️");
  };

  const handleDeleteGroup = async (key: string) => {
    if (window.confirm(`确定要删除人群标签「${key}」吗？\n警告：删除后该人群对应的备餐数据将无法映射，关联的明细项目将失去父节点分类！`)) {
      try {
        await PrepReportService.deleteGroup(key);
        const freshGroups = PrepReportService.getActiveGroups();
        setGroups(freshGroups);
        if (editingGroupKey === key) {
          setEditingGroupKey(null);
          setGroupKeyInput(generateUniqueGroupKey());
          setGroupLabelInput("");
          setGroupEmojiInput("🏫");
        }
        if (onRefresh) onRefresh();
      } catch (err: any) {
        alert(err.message || "删除失败");
      }
    }
  };

  return (
    <div className="space-y-6 max-w-4xl animate-fade-in">
      <section className="bg-white rounded-xl shadow-xs border border-slate-200 p-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <div className="flex items-center space-x-2.5">
            <Users className="text-teal-600" size={18} />
            <h3 className="text-sm font-bold text-slate-900">一级餐位人群标签（级联决策根）</h3>
          </div>
          <span className="text-[10px] bg-teal-50 text-teal-700 font-mono px-2 py-0.5 rounded-full font-extrabold">
            {groups.length} 项聚焦
          </span>
        </div>

        {/* 现有列表 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          {groups.map((g) => {
            const isEditing = editingGroupKey === g.key;
            return (
              <div
                key={g.key}
                className={`flex items-center justify-between p-3 rounded-lg border text-xs transition-all ${isEditing
                    ? "bg-teal-50 border-teal-300 shadow-xs"
                    : "bg-slate-50 border-slate-100 hover:bg-slate-100/80"
                  }`}
              >
                <div className="min-w-0">
                  <span className="font-extrabold text-slate-800 truncate block">{g.label}</span>
                  <span className="text-[10px] text-slate-400 font-mono mt-0.5 block">标识: {g.key}</span>
                </div>

                <div className="flex items-center space-x-1 shrink-0">
                  <button
                    onClick={() => handleStartEditGroup(g)}
                    className="p-1 text-slate-500 hover:text-teal-600 hover:bg-white rounded border border-transparent hover:border-slate-200 cursor-pointer"
                    title="编辑"
                    disabled={isEditing}
                  >
                    <Edit2 size={11} />
                  </button>
                  <button
                    onClick={() => handleDeleteGroup(g.key)}
                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-white rounded border border-transparent hover:border-slate-200 cursor-pointer"
                    title="删除"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* 新增/编辑表单 */}
        <form onSubmit={handleSaveGroupSubmit} className="bg-slate-50 rounded-lg p-4 border border-slate-200">
          <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-3">
            <Sparkles size={13} className="text-teal-600" />
            {editingGroupKey ? "修改现有群体标签参数" : "定义并注入全新的一级受众人群大类"}
          </h4>

          {groupError && (
            <div className="text-[11px] bg-rose-50 text-rose-600 p-2.5 rounded border border-rose-100 mb-3 flex items-center space-x-1.5">
              <ShieldAlert size={12} className="shrink-0" />
              <span>{groupError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-bold text-slate-500 block mb-1">唯一识别Key (系统唯一分配)</label>
              <input
                type="text"
                value={groupKeyInput}
                disabled={true}
                className="w-full bg-slate-100 text-slate-400 text-xs p-2 border border-slate-350 rounded outline-none font-mono"
                required
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 block mb-1">群体受众名称 (如: 特殊餐包/职工餐)</label>
              <input
                type="text"
                placeholder="如: 特别保障餐"
                value={groupLabelInput}
                onChange={(e) => setGroupLabelInput(e.target.value)}
                className="w-full bg-white text-xs text-slate-850 p-2 border border-slate-300 rounded focus:border-teal-500 outline-none"
                required
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 block mb-1.5">受众图标/头像 Emoji</label>
              <div className="grid grid-cols-5 gap-1.5 p-1.5 border border-slate-200 rounded-lg bg-slate-50 max-h-[105px] overflow-y-auto scrollbar-thin">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setGroupEmojiInput(emoji)}
                    className={`h-8 w-8 flex items-center justify-center text-lg rounded-md transition-all cursor-pointer ${
                      groupEmojiInput === emoji
                        ? "bg-teal-500 text-white scale-110 shadow-sm font-bold"
                        : "bg-white border border-slate-200/60 hover:bg-slate-100/80 text-slate-800"
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end items-center mt-3.5 space-x-2">
            {editingGroupKey && (
              <button
                type="button"
                onClick={() => {
                  setEditingGroupKey(null);
                  setGroupKeyInput("");
                  setGroupLabelInput("");
                }}
                className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-xs cursor-pointer font-bold transition-all"
              >
                取消修改
              </button>
            )}
            <button
              type="submit"
              className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs cursor-pointer font-bold flex items-center space-x-1 shadow-sm"
            >
              {editingGroupKey ? <Check size={12} /> : <PlusCircle size={12} />}
              <span>{editingGroupKey ? "保存修改" : "确认新增群体"}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
