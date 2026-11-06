// 生成一份用于压测的大 Markdown 文档（默认 ~200KB / 约 3000 行）
// 用法：node scripts/make-large-doc.mjs [输出路径] [章节数]
import { writeFileSync } from "node:fs";

const out = process.argv[2] ?? "D:/notes/压测文档.md";
const sections = Number(process.argv[3] ?? 120);

const parts = ["---", "title: 压测文档", "updated: 2026-11-06", "---", "", "# 压测文档", ""];

for (let i = 1; i <= sections; i += 1) {
  parts.push(`## 第 ${i} 节 · 抽样与截止性测试`, "");
  parts.push(
    `本节记录第 ${i} 批凭证的抽样过程。选取样本 ${20 + (i % 7)} 笔，金额合计 ${(1000 + i * 37).toLocaleString("zh-CN")} 元，` +
      `截止日为 2025-12-31，**未发现跨期事项**。抽样方法与上年保持一致，` +
      `对异常分录逐笔追踪至原始单据，并记录了访谈对象与时间。`,
    "",
  );
  parts.push("| 凭证号 | 摘要 | 金额 | 截止日 | 结论 |", "| --- | --- | ---: | --- | :---: |");
  for (let r = 1; r <= 4; r += 1) {
    parts.push(`| 记-${i}-${r} | 采购付款-供应商${r} | ${(r * 1234 + i * 10).toLocaleString("zh-CN")} | 2025-12-${10 + r} | 无异常 |`);
  }
  parts.push("");
  parts.push("- 抽样方法：分层随机", "- 检查内容：合同、发票、验收单、付款凭证", `- 复核人：审计员 ${(i % 5) + 1}`, "");
  if (i % 3 === 0) {
    parts.push("```ts", `// 第 ${i} 节的重算脚本`, `const total = rows.reduce((s, r) => s + r.amount, ${i});`, "console.log(total);", "```", "");
  }
  if (i % 5 === 0) {
    parts.push("> 备注：本节的差异率低于重要性水平的 5%，无需扩大样本。", "");
  }
  if (i % 7 === 0) {
    parts.push(`公式复核：$E = mc^2$，以及与上年对比的比值 $r_{${i}} = \\frac{a}{b}$。`, "");
  }
}

const text = parts.join("\n");
writeFileSync(out, text, "utf8");
console.log(
  `已生成 ${out}：${(text.length / 1024).toFixed(0)} KB，${text.split("\n").length} 行，${sections} 个章节`,
);
