# 来源与取舍

核查日期：2026-11-09。这里区分三类依据：开源作者的工程/审美主张、可用性指南、可访问性要求。本 skill 是面向产品界面的原创综合，不是“AI 生成检测标准”。规则不声称能给出可靠的 AI 含量分数。

## 开源实践

| 编号 | 已核查来源 | 借鉴内容与边界 |
|---|---|---|
| S1 | [Impeccable](https://github.com/pbakaus/impeccable/tree/613fbf88e0ef08709eaf238653285f430250c0ea)，Apache-2.0 | 从模板视觉、布局、信息删减和文案清晰度分别检查 UI；不继承固定圆角、全禁眉题或所有嵌套卡片均错误等绝对偏好 |
| S2 | [UI Skills](https://github.com/ibelick/ui-skills/tree/97dea9e747ea94d5671ef1468cbb8f9bd5f32542)，MIT | 采用组件复用、状态处理、交互与可访问性检查；不要求项目改用指定 CSS/动画库，不继承只读审查的额外批准步骤 |
| S3 | [Anthropic frontend-design](https://github.com/anthropics/skills/blob/2c5958ecac7cee2b583967a2c4981d0f4a75c579/skills/frontend-design/SKILL.md)，该目录 Apache-2.0 | 形式应服务产品任务、避免重复默认美学；不将某字体、颜色或主题本身判为错误 |

本次阅读的具体文件，供复核原始上下文：

- S1：[入口](https://github.com/pbakaus/impeccable/blob/613fbf88e0ef08709eaf238653285f430250c0ea/skill/SKILL.src.md)、[craft-floor](https://github.com/pbakaus/impeccable/blob/613fbf88e0ef08709eaf238653285f430250c0ea/skill/reference/craft-floor.md)、[layout](https://github.com/pbakaus/impeccable/blob/613fbf88e0ef08709eaf238653285f430250c0ea/skill/reference/layout.md)、[distill](https://github.com/pbakaus/impeccable/blob/613fbf88e0ef08709eaf238653285f430250c0ea/skill/reference/distill.md)、[clarify](https://github.com/pbakaus/impeccable/blob/613fbf88e0ef08709eaf238653285f430250c0ea/skill/reference/clarify.md)、[许可证](https://github.com/pbakaus/impeccable/blob/613fbf88e0ef08709eaf238653285f430250c0ea/LICENSE)。
- S2：[baseline-ui](https://github.com/ibelick/ui-skills/blob/97dea9e747ea94d5671ef1468cbb8f9bd5f32542/skills/baseline-ui/SKILL.md)、[improve-ui](https://github.com/ibelick/ui-skills/blob/97dea9e747ea94d5671ef1468cbb8f9bd5f32542/skills/improve-ui/SKILL.md)、[许可证](https://github.com/ibelick/ui-skills/blob/97dea9e747ea94d5671ef1468cbb8f9bd5f32542/LICENSE)。
- S3：[许可证](https://github.com/anthropics/skills/blob/2c5958ecac7cee2b583967a2c4981d0f4a75c579/skills/frontend-design/LICENSE.txt)。

## 官方设计与可访问性资料

| 编号 | 来源 | 本 skill 的用法 |
|---|---|---|
| S4 | NN/g：[Aesthetic and Minimalist Design](https://www.nngroup.com/articles/aesthetic-minimalist-design/) | 减少无关信息竞争，同时保留完成任务所需内容；不能把可用性原则等同某种极简视觉风格 |
| S5 | NN/g：[Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | 将低频细节后置，并使入口可发现；先确定常用与次要信息的分界 |
| S6 | GOV.UK：[Details](https://design-system.service.gov.uk/components/details/) | 适合仅部分用户需要的内容，不能藏起多数人需要的信息 |
| S7 | GOV.UK：[Inset text](https://design-system.service.gov.uk/components/inset-text/) | 强调块须少用；复杂页面中不应用它承载必须被注意的关键内容。单侧边界并非天然错误 |
| S8 | GOV.UK：[Warning text](https://design-system.service.gov.uk/components/warning-text/) | 对重要后果使用清楚、适当的提醒；不把所有提示都做成警告 |
| S9 | Carbon：[Data table](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines) | 同类数据的组织、排序、行操作与展开详情；为卡片以外的结构提供成熟参照 |
| S10 | Carbon：[Content](https://www.carbondesignsystem.com/building-blocks/foundations/content)；GOV.UK：[Text input](https://design-system.service.gov.uk/components/text-input/) | 文案应帮助导航和行动；必要提示靠近字段，长解释不能全塞入 hint text |
| S11 | W3C：[Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) | 不能仅以颜色传达状态或含义；禁止彩条作为唯一状态提示不等于禁止用颜色 |
| S12 | W3C：[Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | 不为淡雅而牺牲文字对比度；普通文字通常需至少 4.5:1，大字 3:1，适用例外以原规范为准 |
| S13 | W3C：[Disclosure Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) | 自定义展开控件的键盘和状态语义；不是随意给原生元素增加 ARIA 的理由 |

## 综合判断与本地偏好

- **装饰性单侧边默认避免**：来自用户明确点名的问题与开源实践；对选中、告警、引用等有语义的用法保留例外。
- **不必要说明与信息全外露优先清理**：以任务相关性决定删、移或保留，不能简单规定每页最多几段字。
- **不确定性按事实表达**：模糊兜底要具体化，但不能编造时间、原因、覆盖率，也不能删掉会改变决定的真实限制。这是本 skill 的综合原则，不宣称某一来源定义了这套中文状态写法。
- **高密度不等于杂乱**：业务表格和监控工作台可以密集；“信息爆炸”应看关系、重复和优先级，而非元素总数。
- **可访问性与审美分开判断**：WCAG 的适用要求不能与个人字体/配色喜好混为一谈。本清单不是完整可访问性认证。

## 复用边界

本目录没有打包第三方完整 prompt、源码或图片；中文规则、分类和案例均为独立编写。MIT 标识覆盖本 skill 的原创内容，不改变链接材料的权利和许可证。以后若实际复制第三方代码或文本，应按对应文件的许可证保留必要声明。

来源可能更新；开源链接固定到本次核查提交，官方站点链接指向当前文档。更新规则时重新核查相关条目即可，不要求每次执行 skill 都联网，也不把上游的新审美偏好自动变为硬性限制。
