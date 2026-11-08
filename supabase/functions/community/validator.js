const segmenter = new Intl.Segmenter("zh", { granularity: "grapheme" });
function glyphs(text) {
  return Array.from(segmenter.segment(text), (x) => x.segment);
}
const curationDefaults = {
  lengths: "2,3",
  category: "",
  recipes: "direct,suffix,prefix,semantic,contrast",
  includes: "",
  excludes: "",
  offset: 0,
  reviewedResourceId: ""
};
function validateCuration(p) {
  if (!/^[1-9]\d?(,[1-9]\d?)*$/.test(String(p.lengths))) throw new Error("字数使用逗号分隔的 1–99 整数");
  if (!Number.isInteger(p.offset) || Number(p.offset) < 0 || Number(p.offset) > 1e4) throw new Error("继续抽取位置需要 0–10000 整数");
}
const categories = ["han", "latin", "letter", "number", "mark", "symbol", "punctuation", "space"];
const defaultGameRule = { name: "通用示例（可编辑）", lengths: { graphemes: { min: 2, max: 12 } }, allowed: [...categories], forbidden: "", allowSpaces: false, allowSpecial: true, blockZeroWidth: true };
function parseGameRule(value) {
  let r;
  try {
    r = JSON.parse(value);
  } catch {
    throw new Error("游戏规则需要有效 JSON");
  }
  if (!r || typeof r.name !== "string" || !r.name.trim() || r.name.length > 60 || !r.lengths || typeof r.lengths !== "object" || Array.isArray(r.lengths)) throw new Error("游戏规则名称或长度配置无效");
  for (const [unit, range] of Object.entries(r.lengths)) if (!["codePoints", "graphemes", "bytes"].includes(unit) || !range || !Number.isInteger(range.min) || !Number.isInteger(range.max) || range.min < 0 || range.max < range.min || range.max > 4096) throw new Error("游戏长度区间需要 0–4096 的整数");
  if (!Array.isArray(r.allowed) || r.allowed.some((c) => !categories.includes(c)) || typeof r.forbidden !== "string" || r.forbidden.length > 256 || [r.allowSpaces, r.allowSpecial, r.blockZeroWidth].some((v) => typeof v !== "boolean")) throw new Error("游戏字符规则无效");
  return r;
}
const chineseDefinitions = {
  pinyin: {
    id: "pinyin",
    name: "拼音与音韵",
    category: "中文",
    color: "orange",
    inputs: 1,
    description: "上下文拼音、首字母、声母、韵母、声调或逐字多音候选；候选读音不代表语境正确",
    defaults: { mode: "pinyin", tone: "symbol", separator: " ", limit: 32 }
  },
  homophones: {
    id: "homophones",
    name: "同音字查询",
    category: "中文",
    color: "purple",
    inputs: 1,
    description: "按输入单字的候选读音查询 Unihan 普通话索引；可区分声调，不保证穷尽所有异读",
    defaults: { matchTone: true, limit: 64 }
  },
  rhyme: {
    id: "rhyme",
    name: "押韵筛选",
    category: "中文",
    color: "orange",
    inputs: 1,
    description: "按词尾的现代普通话韵母严格相等筛选，非古韵或十三辙合并",
    defaults: { reference: "星光", matchTone: false }
  },
  hanconvert: {
    id: "hanconvert",
    name: "简繁与火星文",
    category: "中文",
    color: "purple",
    inputs: 1,
    description: "OpenCC 简繁或项目趣味多候选映射；按种子控制逐字转换概率，未映射字符保留",
    defaults: { mode: "traditional", probability: 1, limit: 32, mappingId: "" }
  },
  mapchars: {
    id: "mapchars",
    name: "自定义字符映射",
    category: "中文",
    color: "purple",
    inputs: 1,
    description: 'JSON 单字符到候选数组，例如 {"月":["玥","鈅"]}；有界枚举，固定种子可复现',
    defaults: { mapping: '{"月":["玥","鈅"],"星":["煋","☆"]}', probability: 1, limit: 32, mappingId: "" }
  },
  decompose: {
    id: "decompose",
    name: "汉字结构拆解",
    category: "汉字结构",
    color: "orange",
    inputs: 1,
    description: "逐字拆解左右、上下和包围结构；递归深度可调，描述与未编码部件不是真实新汉字",
    defaults: { depth: 1, structure: "any" }
  },
  components: {
    id: "components",
    name: "汉字部件提取",
    category: "汉字结构",
    color: "orange",
    inputs: 1,
    description: "按指定深度提取部件，每个部件独立输出；未编码部件标为部件编号",
    defaults: { depth: 2 }
  },
  compose: {
    id: "compose",
    name: "部件反查与组字",
    category: "汉字结构",
    color: "green",
    inputs: 1,
    description: "输入日、月等部件，仅查数据中真实存在的字；精确模式比较含重复次数的部件集合",
    defaults: { match: "exact", deep: false, structure: "any", minStrokes: 0, maxStrokes: 64, limit: 64 }
  },
  hanfilter: {
    id: "hanfilter",
    name: "结构与笔画筛选",
    category: "汉字结构",
    color: "orange",
    inputs: 1,
    description: "按逐字结构与 Unihan 笔画数筛选；缺少笔画数据不冒充零画",
    defaults: { structure: "any", minStrokes: 0, maxStrokes: 64 }
  }
};
function isChineseOp(op) {
  return Object.hasOwn(chineseDefinitions, op);
}
const chineseChoices = {
  "pinyin.mode": ["pinyin", "first", "initial", "final", "tone", "polyphonic"],
  "pinyin.tone": ["symbol", "num", "none"],
  "hanconvert.mode": ["traditional", "simplified", "martian"],
  "compose.match": ["exact", "contains"],
  structure: ["any", "left-right", "top-bottom", "enclosure", "other"]
};
function validateChineseParams(op, p) {
  for (const key of Object.keys(chineseDefinitions[op].defaults)) {
    const choices = chineseChoices[`${op}.${key}`] || chineseChoices[key];
    if (choices && !choices.includes(String(p[key]))) throw new Error(`${key} 选项无效`);
    if (typeof p[key] === "number" && !Number.isFinite(p[key])) throw new Error(`${key} 需要有限数值`);
  }
  if (p.limit !== void 0 && (!Number.isInteger(p.limit) || Number(p.limit) < 1 || Number(p.limit) > 128)) throw new Error("候选上限为 1–128");
  if (p.depth !== void 0 && (!Number.isInteger(p.depth) || Number(p.depth) < 1 || Number(p.depth) > 6)) throw new Error("递归深度为 1–6");
  if (p.probability !== void 0 && (Number(p.probability) < 0 || Number(p.probability) > 1)) throw new Error("转换概率为 0–1");
  if (p.minStrokes !== void 0 && (!Number.isInteger(p.minStrokes) || !Number.isInteger(p.maxStrokes) || Number(p.minStrokes) < 0 || Number(p.maxStrokes) > 64 || Number(p.minStrokes) > Number(p.maxStrokes))) throw new Error("笔画范围需要为 0–64 的整数且下限不大于上限");
  if (op === "mapchars") parseCharacterMap(String(p.mapping));
  if (op === "rhyme" && !String(p.reference).trim()) throw new Error("请填写押韵参照词");
}
function parseCharacterMap(source) {
  if (source.length > 16384) throw new Error("映射 JSON 最多 16384 个代码单元");
  let map;
  try {
    map = JSON.parse(source);
  } catch {
    throw new Error("字符映射需要有效 JSON");
  }
  if (!map || typeof map !== "object" || Array.isArray(map) || Object.keys(map).length > 256) throw new Error("字符映射需要对象，最多 256 个字符");
  for (const [key, values] of Object.entries(map)) {
    if (Array.from(key).length !== 1 || !Array.isArray(values) || !values.length || values.length > 32 || values.some((v) => typeof v !== "string" || !v || v.length > 64)) throw new Error("映射键需为单码点字符，每字 1–32 个非空候选，每候选最多 64 个代码单元");
  }
  return map;
}
const builtinOperators = {
  curate: { id: "curate", name: "精选与多样性", category: "处理", description: "按关系评分、风格标签和种子排序；同批优先不同核心", inputs: 1, color: "orange", defaults: curationDefaults },
  extension: { id: "extension", name: "扩展算子", category: "扩展", description: "固定版本的声明式流水线；AST/实验室不适用", inputs: 1, color: "purple", defaults: { pack: "glyphforge-text", version: "1.0.0", operator: "frame", values: "{}", mappingId: "" } },
  mutate: { id: "mutate", name: "名字变异", category: "生成", description: "按字符簇位置锁定、固定种子的有界衍生创作", inputs: 0, color: "purple", defaults: { source: '{"text":"月","parts":[]}', locks: "[]", operations: '["replace","insert","affix"]', intensity: 1, count: 64, pool: "星月云梦", prefix: "小|夜", suffix: "子|酱", resourceId: "", mappingId: "", algorithm: 1 } },
  call: { id: "call", name: "子图调用", category: "函数", description: "调用稳定版本的参数化子图", inputs: 0, color: "purple", defaults: {} },
  argument: { id: "argument", name: "序列参数", category: "函数", description: "显式的子图序列输入", inputs: 0, color: "green", defaults: { name: "input" } },
  gamecheck: { id: "gamecheck", name: "游戏 ID 检查", category: "处理", description: "复用可配置的 Unicode 长度和字符规则，筛选或标注结果", inputs: 1, color: "orange", defaults: { rules: JSON.stringify(defaultGameRule), mode: "filter" } },
  pairs: {
    id: "pairs",
    name: "关系词对",
    category: "数据源",
    description: "按行读取明确的关联关系，左右端始终绑定",
    inputs: 0,
    color: "green",
    defaults: { resourceId: "p1b-sky", relation: "" }
  },
  template: {
    id: "template",
    name: "共享变量模板",
    category: "生成",
    description: "绑定多个词库或关系槽位，用模板生成一组呼应的名字",
    inputs: 0,
    color: "purple",
    defaults: { slots: '[{"name":"sky","resourceId":"p1b-sky","kind":"pair","relation":""}]', templates: '["{sky.left}","{sky.right}"]', separator: " / ", maxLength: 16, equalLength: false }
  },
  group: {
    id: "group",
    name: "成员分组",
    category: "生成",
    description: "去重后为 N 人生成统一前后缀、结构与长度的名字",
    inputs: 1,
    color: "purple",
    defaults: { count: 3, batches: 1, prefix: "星河", suffix: "", separator: "·", joiner: " / ", maxLength: 16, random: true }
  },
  ...chineseDefinitions,
  program: {
    id: "program",
    name: "循环与条件",
    category: "控制流",
    description: "结构化编辑 for / if / let / emit，支持嵌套与类型检查",
    inputs: 0,
    color: "purple",
    defaults: {}
  },
  resource: {
    id: "resource",
    name: "词库输入",
    category: "数据源",
    description: "引用独立管理的字词库",
    inputs: 0,
    color: "green",
    defaults: { resourceId: "nature" }
  },
  pattern: {
    id: "pattern",
    name: "模式组合",
    category: "生成",
    description: "用 A、B 绑定两个输入，组合每一种可能",
    inputs: 2,
    color: "purple",
    defaults: { template: "AB" }
  },
  concat: {
    id: "concat",
    name: "文字拼接",
    category: "生成",
    description: "组合两个词库，可添加分隔符",
    inputs: 2,
    color: "purple",
    defaults: { separator: "" }
  },
  filter: {
    id: "filter",
    name: "条件筛选",
    category: "处理",
    description: "按可见字符长度、包含和排除条件过滤",
    inputs: 1,
    color: "orange",
    defaults: { maxLength: 6, includes: "", excludes: "" }
  },
  prefix: {
    id: "prefix",
    name: "添加前缀",
    category: "处理",
    description: "为每个名字添加相同的前缀",
    inputs: 1,
    color: "orange",
    defaults: { text: "小" }
  },
  reverse: {
    id: "reverse",
    name: "文字倒序",
    category: "处理",
    description: "按 Unicode 字符簇倒序，保留完整 Emoji",
    inputs: 1,
    color: "orange",
    defaults: {}
  },
  output: {
    id: "output",
    name: "结果输出",
    category: "输出",
    description: "去重后流式输出到结果工作台",
    inputs: 1,
    color: "blue",
    defaults: {}
  }
};
const operators = Object.fromEntries(
  Object.entries(builtinOperators).map(([id, definition]) => [
    id,
    {
      ...definition,
      version: 1,
      inputTypes: Array.from(
        { length: definition.inputs },
        () => "CandidateSequence"
      ),
      outputType: "CandidateSequence",
      deterministic: true,
      streaming: id !== "group" && id !== "curate"
    }
  ])
);
const relationLabels = {
  associated: "关联",
  antonym: "反义",
  couple: "情侣",
  parallel: "对仗关联"
};
function validRelation(value) {
  return typeof value === "string" && Object.hasOwn(relationLabels, value);
}
function validatePair(row) {
  const r = row;
  if (!r || !validRelation(r.relation) || [r.left, r.right].some((x) => typeof x !== "string" || !x.trim() || x.length > 256))
    throw new Error("关系行需要非空的左右词（各最多 256 字符）及有效的关系类型");
  if (r.direction !== void 0 && !["symmetric", "directed", "unknown"].includes(r.direction)) throw new Error("无效关系方向");
  if (r.reverseQueryable !== void 0 && typeof r.reverseQueryable !== "boolean") throw new Error("反向查询开关无效");
  if (r.weight !== void 0 && (!Number.isFinite(r.weight) || r.weight < 0 || r.weight > 100)) throw new Error("关系权重需要 0–100");
  if (r.tags !== void 0 && (!Array.isArray(r.tags) || r.tags.length > 16 || r.tags.some((t) => typeof t !== "string" || t.length > 40))) throw new Error("关系标签最多 16 个，各 40 字符");
  for (const field of ["note", "source"]) if (r[field] !== void 0 && (typeof r[field] !== "string" || r[field].length > 256)) throw new Error("关系备注/来源最多 256 字符");
}
function templateConfig(p) {
  let slots, templates;
  try {
    slots = JSON.parse(String(p.slots));
    templates = JSON.parse(String(p.templates));
  } catch {
    throw new Error("槽位和名字模板需要有效的 JSON 数组");
  }
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > 6 || slots.some((s) => !s || typeof s.name !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(s.name) || typeof s.resourceId !== "string" || !s.resourceId || s.resourceId.length > 256 || !["word", "pair"].includes(s.kind) || s.relation !== void 0 && s.relation !== "" && !validRelation(s.relation)))
    throw new Error("需要 1–6 个有效槽位，名称使用英文字母、数字或下划线");
  const names = new Map(slots.map((s) => [s.name, s]));
  if (names.size !== slots.length) throw new Error("槽位名称不能重复");
  if (!Array.isArray(templates) || !templates.length || templates.length > 8 || templates.some((t) => typeof t !== "string" || !t || t.length > 256))
    throw new Error("需要 1–8 个非空名字模板，各最多 256 字符");
  for (const t of templates) {
    const remainder = t.replace(/\{([A-Za-z][A-Za-z0-9_]*)(?:\.(left|right))?\}/g, (_, name, side) => {
      const slot = names.get(name);
      if (!slot || slot.kind === "pair" !== Boolean(side)) throw new Error(`模板变量 ${name}${side ? `.${side}` : ""} 无效`);
      return "";
    });
    if (/[{}]/.test(remainder)) throw new Error("模板使用 {变量} 或 {关系槽.left} / {关系槽.right}");
  }
  return { slots, templates };
}
function validateRelationParams(op, p) {
  const integer = (key, max) => {
    if (!Number.isInteger(p[key]) || Number(p[key]) < 1 || Number(p[key]) > max) throw new Error(`${key} 需要 1–${max} 的整数`);
  };
  if (op === "pairs" && p.relation !== "" && !validRelation(p.relation)) throw new Error("未知关系类型");
  if (op === "template") {
    templateConfig(p);
    integer("maxLength", 100);
  }
  if (op === "group") {
    integer("count", 100);
    integer("batches", 100);
    integer("maxLength", 100);
  }
}
const mutationOperations = { replace: "替换字符", insert: "插入字符", delete: "删除字符", affix: "前后缀", dictionary: "词库替换", reorder: "调整词序", homophone: "谐音替换", martian: "火星文" };
operators.mutate.defaults;
function mutationConfig(p) {
  const source = JSON.parse(String(p.source)), locks = JSON.parse(String(p.locks)), operations = JSON.parse(String(p.operations));
  if (!source || typeof source.text !== "string" || !source.text || source.text.length > 1024 || glyphs(source.text).length > 100 || !Array.isArray(source.parts) || source.parts.length > 128 || source.parts.some((x) => !x || typeof x.text !== "string" || x.text.length > 1024 || typeof x.resourceId !== "string")) throw new Error("变异输入需为 1–100 个字符簇、最多128来源片段");
  if (source.derivation && (source.derivation.kind !== "mutation" || source.derivation.version !== 1 || !Number.isInteger(source.derivation.round) || source.derivation.round < 1 || source.derivation.round > 1e6)) throw new Error("衍生版本或轮数无效");
  if (!Array.isArray(locks) || locks.length > 100 || locks.some((i) => !Number.isInteger(i) || i < 0 || i >= glyphs(source.text).length) || new Set(locks).size !== locks.length) throw new Error("锁定位置无效");
  if (!Array.isArray(operations) || !operations.length || operations.length > 8 || operations.some((op) => !Object.hasOwn(mutationOperations, op)) || new Set(operations).size !== operations.length) throw new Error("请选择有效的变异操作");
  if (![1, 2, 3].includes(Number(p.intensity)) || !Number.isInteger(p.count) || Number(p.count) < 1 || Number(p.count) > 256 || p.algorithm !== 1) throw new Error("变异强度为1–3、数量为1–256、算法版本为1");
  if (!String(p.pool) || operations.includes("dictionary") && !String(p.resourceId)) throw new Error("字符池或替换词库缺失");
  return { source, locks, operations };
}
class ContractError extends Error {
  constructor(diagnostic) {
    super(`${diagnostic.nodeId ? `节点 ${diagnostic.nodeId}：` : ""}${diagnostic.line ? `第 ${diagnostic.line} 行：` : ""}${diagnostic.message}`);
    this.diagnostic = diagnostic;
    this.name = "ContractError";
  }
  diagnostic;
}
function diagnose(error, context = {}) {
  const diagnostic = error instanceof ContractError ? error.diagnostic : {
    code: context.code ?? "EXECUTION",
    message: error instanceof Error ? error.message : "算子执行失败"
  };
  return new ContractError({ ...context, ...diagnostic, nodeId: diagnostic.nodeId ?? context.nodeId, line: diagnostic.line ?? context.line });
}
const executionBudget = Object.freeze({ steps: 3e5, milliseconds: 1e4, results: 1e4, batch: 64, textCodeUnits: 1024 });
const scalarType = (value) => {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  return "boolean";
};
function astSignature(op) {
  const keys2 = Object.keys(operators[op].defaults);
  if (isChineseOp(op)) return { args: ["string", ...keys2.map((k) => scalarType(operators[op].defaults[k]))], result: "strings", required: 1, parameters: [null, ...keys2] };
  switch (op) {
    case "resource":
      return { args: ["string"], result: "strings", required: 1, parameters: ["resourceId"] };
    case "pairs":
      return { args: ["string", "string"], result: "pairs", required: 1, parameters: ["resourceId", "relation"] };
    case "gamecheck":
      return { args: ["string", "string"], result: "boolean", required: 1, parameters: [null, "rules"] };
    case "pattern":
      return { args: ["string", "string", "string"], result: "string", required: 3, parameters: ["template", null, null] };
    case "concat":
      return { args: ["string", "string", "string"], result: "string", required: 2, parameters: [null, null, "separator"] };
    case "prefix":
      return { args: ["string", "string"], result: "string", required: 1, parameters: [null, "text"] };
    case "reverse":
      return { args: ["string"], result: "string", required: 1, parameters: [null] };
    default:
      return void 0;
  }
}
function buildContract(op) {
  const def = operators[op];
  return {
    id: op,
    version: def.version,
    graph: { inputs: def.inputTypes, output: def.outputType },
    parameters: Object.fromEntries(Object.entries(def.defaults).map(([key, value]) => [key, { type: scalarType(value), default: value, maxLength: parameterLimit(op, key) }])),
    ast: astSignature(op),
    lab: isChineseOp(op) || ["prefix", "reverse", "filter"].includes(op),
    determinism: "seed-and-resource-versions",
    streaming: def.streaming ? "incremental" : "buffered",
    budget: { scope: "run", tick: "inherited", limits: executionBudget }
  };
}
const operatorContracts = Object.fromEntries(
  Object.keys(operators).map((id) => [id, buildContract(id)])
);
const astSignatures = {
  ...Object.fromEntries(Object.values(operatorContracts).filter((c) => c.ast).map((c) => [c.id, c.ast])),
  ...Object.fromEntries(["left", "right", "relation"].map((name) => [name, { args: ["pair"], result: "string", required: 1 }])),
  range: { args: ["number", "number"], result: "numbers", required: 2 },
  length: { args: ["string"], result: "number", required: 1 },
  contains: { args: ["string", "string"], result: "boolean", required: 2 },
  startsWith: { args: ["string", "string"], result: "boolean", required: 2 },
  endsWith: { args: ["string", "string"], result: "boolean", required: 2 },
  text: { args: ["number"], result: "string", required: 1 }
};
function parameterLimit(op, key) {
  if (op === "extension" && key === "values") return 8192;
  if (op === "mutate" && key === "source") return 32768;
  if (op === "mutate" && key === "locks") return 512;
  return op === "gamecheck" && key === "rules" || op === "mapchars" && key === "mapping" || op === "template" && ["slots", "templates"].includes(key) ? 16384 : 256;
}
function normalizeParams(op, supplied) {
  if (!Object.hasOwn(operators, op)) throw new ContractError({ code: "TYPE", message: `未知算子 ${op}` });
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new ContractError({ code: "PARAMETER", operator: op, message: "节点参数无效" });
  const p = { ...operators[op].defaults, ...supplied };
  try {
    for (const [key, value] of Object.entries(operators[op].defaults)) {
      if (typeof p[key] !== typeof value || typeof p[key] === "number" && !Number.isFinite(p[key]))
        throw new ContractError({ code: "PARAMETER", operator: op, parameter: key, message: `${key} 参数类型错误或不是有限数值` });
      if (typeof p[key] === "string" && String(p[key]).length > parameterLimit(op, key))
        throw new ContractError({ code: "PARAMETER", operator: op, parameter: key, message: `${key} 文字参数过长` });
    }
    if (isChineseOp(op)) validateChineseParams(op, p);
    if (op === "mutate") mutationConfig(p);
    validateRelationParams(op, p);
    if (op === "curate") validateCuration(p);
    if (op === "gamecheck") {
      parseGameRule(String(p.rules));
      if (!["filter", "annotate"].includes(String(p.mode))) throw new Error("游戏检查模式无效");
    }
    if (op === "pattern" && !/^[AB]{1,16}$/.test(String(p.template))) throw new Error("模式需为 1–16 个 A / B，例如 AABB");
    if (op === "filter" && (Number(p.maxLength) < 1 || Number(p.maxLength) > 100)) throw new Error("长度限制需要在 1–100 之间");
    if (["resource", "pairs"].includes(op) && !String(p.resourceId).trim()) throw new Error("资源引用无效");
  } catch (error) {
    throw diagnose(error, { code: "PARAMETER", operator: op });
  }
  return p;
}
function astParams(op, values) {
  const signature = operatorContracts[op].ast;
  const supplied = {};
  signature.parameters?.forEach((key, i) => {
    if (key && values[i] !== void 0) supplied[key] = values[i];
  });
  return normalizeParams(op, supplied);
}
function nodeResourceBindings(op, p) {
  if (op === "curate" && p.reviewedResourceId) return [{ id: String(p.reviewedResourceId), pair: true }];
  const maps = p.mappingId && ["mapchars", "hanconvert", "mutate", "extension"].includes(op) ? [{ id: String(p.mappingId), pair: false, mapping: true }] : [];
  if (op === "mutate") return [...maps, ...p.resourceId ? [{ id: String(p.resourceId), pair: false }] : []];
  if (maps.length) return maps;
  if (op === "resource" || op === "pairs") return [{ id: String(p.resourceId), pair: op === "pairs" }];
  if (op === "template") return templateConfig(p).slots.map((s) => ({ id: s.resourceId, pair: s.kind === "pair" }));
  return [];
}
const packKey = (p) => `${p.id}@${p.version}`;
const safeName = (s) => typeof s === "string" && /^[a-z][a-z0-9-]{0,47}$/.test(s) && !["constructor", "prototype"].includes(s);
const versionOK = (s) => typeof s === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s);
function reject(message) {
  throw new ContractError({ code: "TYPE", message: `扩展包：${message}` });
}
function guardJSON(value, maxBytes = 131072, maxNodes = 12e3) {
  let size = 0, count = 0;
  const walk = (v, depth) => {
    if (depth > 20 || ++count > maxNodes) reject("JSON 深度/数量超过限制");
    if (typeof v === "string") size += v.length * 3;
    else if (typeof v === "number") {
      if (!Number.isFinite(v)) reject("非有限数值");
      size += 16;
    } else if (v && typeof v === "object") {
      if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) reject("仅接受 JSON 对象");
      for (const k of Object.keys(v)) {
        if (["__proto__", "prototype", "constructor"].includes(k)) reject("保留键");
        size += k.length * 3;
        walk(v[k], depth + 1);
      }
    } else if (v !== null && typeof v !== "boolean") reject("非 JSON 值");
    if (size > maxBytes) reject("JSON 大小超过限制");
  };
  walk(value, 0);
}
function keys(v, allowed) {
  if (Object.keys(v).some((k) => !allowed.includes(k))) reject("未知字段或权限");
}
function validatePack(value) {
  guardJSON(value);
  const p = value;
  if (!p || p.format !== "glyphforge-operator-pack" || p.protocol !== 1 || !safeName(p.id) || !versionOK(p.version)) reject("格式/ID/版本不兼容");
  keys(p, ["format", "protocol", "id", "version", "publisher", "source", "compatibility", "permissions", "mode", "deterministic", "streaming", "dependencies", "operators", "migrations"]);
  if (typeof p.publisher !== "string" || !p.publisher || p.publisher.length > 100 || typeof p.source !== "string" || !p.source || p.source.length > 200) reject("发布者/来源无效");
  if (p.compatibility?.ir !== 1 || p.compatibility.contract !== 1) reject("IR/契约范围不兼容");
  keys(p.compatibility, ["ir", "contract"]);
  if (!Array.isArray(p.permissions) || p.permissions.length || p.mode !== "declarative-pipeline" || p.deterministic !== true || p.streaming !== "incremental") reject("执行模式/权限不受支持");
  if (!Array.isArray(p.dependencies) || p.dependencies.length > 16) reject("依赖超过限制");
  const deps = /* @__PURE__ */ new Set();
  for (const d of p.dependencies) {
    keys(d, ["id", "version"]);
    if (!safeName(d.id) || !versionOK(d.version) || deps.has(packKey(d))) reject("依赖 ID/版本重复或无效");
    deps.add(packKey(d));
  }
  if (!Array.isArray(p.operators) || !p.operators.length || p.operators.length > 16) reject("算子数为 1–16");
  const ids = /* @__PURE__ */ new Set();
  for (const o of p.operators) {
    keys(o, ["id", "name", "inputTypes", "outputType", "parameters", "steps"]);
    if (!safeName(o.id) || Object.hasOwn(operators, o.id) || ids.has(o.id) || typeof o.name !== "string" || !o.name || o.name.length > 80) reject("算子 ID 重复、遮蔽内置或名称无效");
    ids.add(o.id);
    if (JSON.stringify(o.inputTypes) !== '["CandidateSequence"]' || o.outputType !== "CandidateSequence") reject("只支持单序列输入输出");
    if (!o.parameters || Array.isArray(o.parameters) || Object.keys(o.parameters).length > 16) reject("参数无效");
    for (const [k, v] of Object.entries(o.parameters)) {
      keys(v, ["type", "default"]);
      if (!/^[a-z][a-zA-Z0-9]{0,31}$/.test(k) || !["string", "number", "boolean"].includes(v.type) || typeof v.default !== v.type || typeof v.default === "string" && v.default.length > 256) reject("参数类型/默认值无效");
    }
    if (!Array.isArray(o.steps) || !o.steps.length || o.steps.length > 16) reject("流水线为 1–16 步");
    for (const s of o.steps) {
      keys(s, ["op", "params", "bindings"]);
      if (!["prefix", "reverse", "filter", "mapchars"].includes(s.op) || !s.params || Array.isArray(s.params)) reject("仅允许白名单流水线");
      const contract = operatorContracts[s.op];
      if (Object.keys(s.params).some((k) => !Object.hasOwn(contract.parameters, k))) reject("未知步骤参数");
      for (const [target, ref] of Object.entries(s.bindings ?? {})) if (!Object.hasOwn(contract.parameters, target) || !Object.hasOwn(o.parameters, ref) || contract.parameters[target].type !== o.parameters[ref].type) reject("参数绑定类型不匹配");
      if (s.op === "mapchars" && (s.params.mappingId || s.bindings?.mappingId && s.bindings.mappingId !== "mappingId")) reject("资源引用必须显式绑定 mappingId");
      normalizeParams(s.op, { ...s.params, ...Object.fromEntries(Object.entries(s.bindings ?? {}).map(([k, ref]) => [k, o.parameters[ref].default])) });
    }
  }
  if (!Array.isArray(p.migrations) || p.migrations.length > 16) reject("迁移数超过限制");
  for (const m of p.migrations) {
    keys(m, ["from", "operator", "rename"]);
    if (!versionOK(m.from) || !ids.has(m.operator) || !m.rename || Object.entries(m.rename).some(([k, v]) => !safeName(k) || typeof v !== "string" || !Object.hasOwn(p.operators.find((o) => o.id === m.operator).parameters, v))) reject("迁移格式无效");
  }
  return structuredClone(p);
}
function validatePacks(packs = []) {
  if (!Array.isArray(packs) || packs.length > 32) reject("最多 32 个包版本");
  const byKey = /* @__PURE__ */ new Map();
  for (const raw of packs) {
    const p = validatePack(raw), key = packKey(p);
    if (byKey.has(key)) reject("包 ID/版本重复");
    byKey.set(key, p);
  }
  const active = /* @__PURE__ */ new Set(), done = /* @__PURE__ */ new Set();
  function visit(key, depth) {
    if (active.has(key)) reject(`循环依赖 ${key}`);
    if (done.has(key)) return;
    if (depth > 12) reject("依赖深度超过 12");
    const p = byKey.get(key);
    if (!p) reject(`缺失依赖或版本不匹配 ${key}`);
    active.add(key);
    for (const d of p.dependencies) visit(packKey(d), depth + 1);
    active.delete(key);
    done.add(key);
  }
  for (const key of byKey.keys()) visit(key, 0);
}
function resolveExtension(n, packs = []) {
  const key = `${n.params.pack}@${n.params.version}`;
  const p = packs.find((p2) => packKey(p2) === key);
  if (!p) reject(`缺失扩展或版本不匹配 ${key}；原节点保留`);
  const o = p.operators.find((o2) => o2.id === n.params.operator);
  if (!o) reject(`未知全限定算子 ${key}/${n.params.operator}`);
  const values = JSON.parse(String(n.params.values));
  guardJSON(values, 8192);
  if (!values || Array.isArray(values) || typeof values !== "object" || Object.keys(values).some((k) => !Object.hasOwn(o.parameters, k))) reject("未知调用参数");
  const params = {};
  for (const [k, d] of Object.entries(o.parameters)) {
    const v = Object.hasOwn(values, k) ? values[k] : d.default;
    if (typeof v !== d.type || typeof v === "number" && !Number.isFinite(v) || typeof v === "string" && v.length > 256) reject(`参数 ${k} 类型/大小错误`);
    params[k] = v;
  }
  if (values.mappingId) reject("Mapping 引用必须使用显式 mappingId 端口");
  if (Object.hasOwn(o.parameters, "mappingId")) params.mappingId = String(n.params.mappingId || "");
  const steps = o.steps.map((s) => ({ ...s, params: normalizeParams(s.op, { ...s.params, ...Object.fromEntries(Object.entries(s.bindings ?? {}).map(([k, ref]) => [k, params[ref]])) }) }));
  return { pack: p, operator: o, steps };
}
function validateWorkflowExtensions(w) {
  validatePacks(w.extensions);
  for (const n of [...w.nodes, ...(w.subgraphs ?? []).flatMap((d) => d.nodes)]) if (n.op === "extension") resolveExtension(n, w.extensions);
}
const parameter = (type, value) => ({ type, default: value });
const firstPartyPacks = [{
  format: "glyphforge-operator-pack",
  protocol: 1,
  id: "glyphforge-text",
  version: "1.0.0",
  publisher: "GlyphForge",
  source: "bundled:glyphforge-text",
  compatibility: { ir: 1, contract: 1 },
  permissions: [],
  mode: "declarative-pipeline",
  deterministic: true,
  streaming: "incremental",
  dependencies: [],
  migrations: [],
  operators: [
    { id: "frame", name: "有界文字结构", inputTypes: ["CandidateSequence"], outputType: "CandidateSequence", parameters: { prefix: parameter("string", "「"), suffix: parameter("string", "」"), mappingId: parameter("string", "") }, steps: [{ op: "mapchars", params: { mapping: "{}" }, bindings: { mappingId: "mappingId" } }, { op: "prefix", params: {}, bindings: { text: "prefix" } }, { op: "reverse", params: {} }, { op: "prefix", params: {}, bindings: { text: "suffix" } }, { op: "reverse", params: {} }] },
    { id: "select", name: "组合条件筛选", inputTypes: ["CandidateSequence"], outputType: "CandidateSequence", parameters: { contains: parameter("string", ""), excludes: parameter("string", ""), maxLength: parameter("number", 12) }, steps: [{ op: "filter", params: {}, bindings: { includes: "contains", maxLength: "maxLength" } }, { op: "filter", params: {}, bindings: { excludes: "excludes", maxLength: "maxLength" } }] }
  ]
}];
firstPartyPacks.push({ ...structuredClone(firstPartyPacks[0]), version: "2.0.0", operators: firstPartyPacks[0].operators.map((o) => o.id === "frame" ? { ...o, parameters: { ...o.parameters, opening: o.parameters.prefix }, steps: o.steps.map((s) => ({ ...s, ...s.bindings ? { bindings: Object.fromEntries(Object.entries(s.bindings).map(([k, v]) => [k, v === "prefix" ? "opening" : v])) } : {} })) } : o), migrations: [{ from: "1.0.0", operator: "frame", rename: { prefix: "opening" } }, { from: "1.0.0", operator: "select", rename: {} }] });
delete firstPartyPacks[1].operators[0].parameters.prefix;
const SHARE_LIMITS = Object.freeze({ json: 1024 * 1024, compressed: 64 * 1024, chars: 87500, ms: 8e3, inputChunk: 128 });
const fallback = "；请下载 JSON 文件或本地保存，减少快照后重试";
const fail$1 = (message) => {
  throw new Error(`分享码：${message}${fallback}`);
};
function validateSharePayload(data) {
  guardJSON(data, 3 * SHARE_LIMITS.json, 15e4);
  const p = data;
  if (!p || p.format !== "glyphforge" || ![1, 2, 3, 4, 5, 6, 7].includes(p.version)) fail$1("仅接受原有 v1–v7 工作流包，禁止嵌套 envelope");
  const allowed = ["format", "version", "irVersion", "operatorVersions", "resourceDefinitionVersion", "workflow", "dependencies", "resources", "packManifest"];
  if (Object.keys(p).some((k) => !allowed.includes(k))) fail$1("工作流包包含未知字段或历史记录");
  if (!p.workflow || !Array.isArray(p.resources) || p.resources.length > 100) fail$1("工作流 / 资源快照无效");
  if (p.dependencies !== void 0 && (!Array.isArray(p.dependencies) || p.dependencies.length > 100)) fail$1("依赖清单超过 100 项或无效");
}
const MAX_CALL_DEPTH = 12;
const keyOf = (d) => `${d.id}@${d.version}`;
const nameOK = (s) => /^[A-Za-z_]\w{0,63}$/.test(s) && !["__proto__", "prototype", "constructor", "return", "fn", "let", "for", "in", "if", "else", "emit", "true", "false"].includes(s);
function fail(message, node, code = "TYPE") {
  throw new ContractError({ code, message, nodeId: node?.id, line: node?.line });
}
function definitionFor(node, definitions = []) {
  const d = definitions.find((d2) => d2.id === node.call?.definitionId && d2.version === node.call?.version);
  if (!d) fail(`子图引用缺失或版本不兼容：${node.call?.definitionId ?? "未绑定"}@${node.call?.version ?? "?"}`, node);
  return d;
}
function inputCount(n, defs = []) {
  return n.op === "call" ? definitionFor(n, defs).parameters.filter((p) => p.type === "CandidateSequence").length : operators[n.op].inputs;
}
function scalar(p, value) {
  if (typeof value !== p.type || typeof value === "number" && !Number.isFinite(value) || typeof value === "string" && value.length > 16384)
    fail(`参数 ${p.name} 需要 ${p.type}`, void 0, "PARAMETER");
  return value;
}
function callBindings(node, d, outer = {}) {
  const result = {};
  const supplied = node.call?.bindings ?? {};
  if (Object.keys(supplied).some((k) => !d.parameters.some((p) => p.name === k && p.type !== "CandidateSequence"))) fail("未知调用参数", node);
  for (const p of d.parameters.filter((p2) => p2.type !== "CandidateSequence")) {
    const ref = node.parameterBindings?.[p.name];
    const value = ref ? outer[ref] : Object.hasOwn(supplied, p.name) ? supplied[p.name] : p.default;
    try {
      result[p.name] = scalar(p, value);
    } catch (e) {
      if (e instanceof ContractError) throw new ContractError({ ...e.diagnostic, nodeId: node.id, line: node.line });
      throw e;
    }
  }
  return result;
}
function validateSubgraphs(w, validateBody) {
  const defs = w.subgraphs ?? [];
  if (!Array.isArray(defs) || defs.length > 100 || defs.reduce((a, d) => a + (d.nodes?.length || 0), 0) > 2e3) fail("子图最多 100 个版本、共 2000 个内部节点");
  const keys2 = /* @__PURE__ */ new Set();
  for (const d of defs) {
    if (!d || typeof d.id !== "string" || !d.id.length || d.id.length > 100 || !Number.isSafeInteger(d.version) || d.version < 1 || typeof d.name !== "string" || !d.name.trim() || d.name.length > 100 || d.returns !== "CandidateSequence" || !Array.isArray(d.parameters) || d.parameters.length > 16 || !Array.isArray(d.nodes)) fail("子图定义或版本无效");
    if (keys2.has(keyOf(d))) fail("子图 ID/version 重复");
    keys2.add(keyOf(d));
    const names = /* @__PURE__ */ new Set();
    for (const p of d.parameters) {
      if (!p || !nameOK(p.name) || names.has(p.name) || !["string", "number", "boolean", "CandidateSequence"].includes(p.type)) fail("子图参数名或类型无效");
      names.add(p.name);
      if (Object.hasOwn(p, "default")) {
        if (p.type === "CandidateSequence") fail("序列参数必须显式连线");
        scalar(p, p.default);
      }
    }
  }
  const done = /* @__PURE__ */ new Map(), visiting = /* @__PURE__ */ new Set();
  function visit(d) {
    const key = keyOf(d);
    if (visiting.has(key)) fail(`禁止循环子图依赖：${key}`);
    if (done.has(key)) return done.get(key);
    visiting.add(key);
    let depth = 1;
    for (const n of d.nodes) if (n.op === "call") depth = Math.max(depth, 1 + visit(definitionFor(n, defs)));
    if (depth > MAX_CALL_DEPTH) fail(`子图调用深度超过 ${MAX_CALL_DEPTH}`, void 0, "BUDGET");
    visiting.delete(key);
    done.set(key, depth);
    validateBody({ ...w, nodes: d.nodes }, d);
    return depth;
  }
  defs.forEach(visit);
}
function validateScopedNode(n, defs, scope) {
  const parameters = scope?.parameters ?? [];
  if (scope && (!nameOK(n.id) || parameters.some((p) => p.name === n.id))) fail("局部节点名称重复、保留或遮蔽参数", n, "SCOPE");
  for (const [target, ref] of Object.entries(n.parameterBindings ?? {})) {
    const p = parameters.find((p2) => p2.name === ref);
    const type = n.op === "call" ? definitionFor(n, defs).parameters.find((p2) => p2.name === target)?.type : operatorContracts[n.op]?.parameters[target]?.type;
    if (!p || p.type === "CandidateSequence" || !type || type !== p.type) fail(`参数 ${target} 引用 ${ref} 越界或类型不符`, n, "SCOPE");
    if (["resourceId", "slots"].includes(target) || n.op === "extension") fail("资源依赖必须为静态 ID", n, "SCOPE");
  }
  if (n.op === "argument") {
    if (!parameters.some((p) => p.name === n.params.name && p.type === "CandidateSequence")) fail("序列参数超出词法作用域", n, "SCOPE");
  } else if (n.op === "call") {
    const d = definitionFor(n, defs);
    const outer = Object.fromEntries(parameters.filter((p) => p.type !== "CandidateSequence").map((p) => [p.name, p.default ?? (p.type === "string" ? "" : p.type === "number" ? 0 : false)]));
    callBindings(n, d, outer);
  } else normalizeParams(n.op, n.params);
}
function allNodes(w) {
  return [...w.nodes, ...(w.subgraphs ?? []).flatMap((d) => d.nodes)];
}
const reserved = /* @__PURE__ */ new Set([
  "__proto__",
  "constructor",
  "prototype",
  "for",
  "in",
  "let",
  "if",
  "else",
  "emit",
  "true",
  "false"
]);
function validateProgram(program) {
  try {
    validateProgramBody(program);
  } catch (error) {
    throw diagnose(error, { code: "TYPE" });
  }
}
function validateProgramBody(program) {
  if (!program || program.version !== 1 || !Array.isArray(program.body))
    throw new Error("无效的程序 IR");
  let size = 0, emits = 0;
  function check(expr, scope, depth = 0, literalLimit = 256) {
    if (!expr || ++size > 2e3 || depth > 40)
      throw new Error("程序超过结构限额");
    const error = (msg) => {
      throw new ContractError({ code: expr.kind === "variable" ? "SCOPE" : "TYPE", line: expr.line, message: msg });
    };
    switch (expr.kind) {
      case "literal":
        if (!["string", "number", "boolean"].includes(typeof expr.value) || typeof expr.value === "string" && expr.value.length > literalLimit || typeof expr.value === "number" && !Number.isFinite(expr.value))
          return error("常量类型或长度无效");
        return typeof expr.value;
      case "resource":
        if (typeof expr.id !== "string" || !expr.id || expr.id.length > 256)
          return error("资源引用无效");
        return "strings";
      case "variable": {
        const type = scope.get(expr.name);
        if (!type) return error(`变量 ${expr.name} 未定义或不在作用域内`);
        return type;
      }
      case "list": {
        if (!Array.isArray(expr.items) || expr.items.length > 1e3)
          return error("集合最多 1,000 项");
        const types = expr.items.map((x) => check(x, scope, depth + 1));
        const type = types[0] || "string";
        if (!["string", "number", "boolean"].includes(type) || types.some((x) => x !== type))
          return error("集合元素必须是相同标量类型");
        return `${type}s`;
      }
      case "call": {
        if (!Object.hasOwn(astSignatures, expr.name) || !Array.isArray(expr.args))
          return error(`不支持的函数 ${expr.name}`);
        const fn = astSignatures[expr.name];
        if (expr.args.length < fn.required || expr.args.length > fn.args.length)
          return error(`${expr.name} 参数需要 (${fn.args.join(", ")})`);
        expr.args.forEach((arg, i) => {
          const key = fn.parameters?.[i];
          if (check(arg, scope, depth + 1, key ? parameterLimit(expr.name, key) : 256) !== fn.args[i]) {
            if (key) throw new ContractError({ code: "PARAMETER", operator: expr.name, parameter: key, line: expr.line, message: `${key} 参数类型错误，需要 ${fn.args[i]}` });
            error(`${expr.name} 参数需要 (${fn.args.join(", ")})`);
          }
        });
        if (["resource", "pairs"].includes(expr.name) && (expr.args[0].kind !== "literal" || typeof expr.args[0].value !== "string"))
          return error(`${expr.name} 需要固定的资源 ID 字符串`);
        if (fn.parameters && expr.args.every((a) => a.kind === "literal" || a.kind === "variable")) {
          if (fn.parameters.every((key, i) => !key || !expr.args[i] || expr.args[i].kind === "literal")) {
            try {
              astParams(expr.name, expr.args.map((a) => a.kind === "literal" ? a.value : void 0));
            } catch (error2) {
              throw diagnose(error2, { line: expr.line });
            }
          }
        }
        return fn.result;
      }
      case "unary": {
        const type = check(expr.value, scope, depth + 1);
        if (expr.op === "!" && type === "boolean" || expr.op === "-" && type === "number")
          return type;
        return error("一元运算类型不匹配");
      }
      case "binary": {
        const a = check(expr.left, scope, depth + 1), b = check(expr.right, scope, depth + 1);
        if (a !== b || !["string", "number", "boolean"].includes(a))
          return error("二元运算需要相同的标量类型");
        if (expr.op === "+" && (a === "string" || a === "number")) return a;
        if (["-", "*", "/"].includes(expr.op) && a === "number")
          return "number";
        if (["&&", "||"].includes(expr.op) && a === "boolean") return "boolean";
        if (["==", "!="].includes(expr.op) || ["<", "<=", ">", ">="].includes(expr.op) && a === "number")
          return "boolean";
        return error("运算符与类型不匹配");
      }
      default:
        return error("未知表达式");
    }
  }
  function block(body, parent, depth) {
    if (!Array.isArray(body) || depth > 12)
      throw new Error("程序代码块无效或超过 12 层嵌套");
    const scope = new Map(parent), locals = /* @__PURE__ */ new Set();
    for (const s of body) {
      if (!s || ++size > 2e3) throw new Error("程序超过结构限额");
      if (s.kind === "let" || s.kind === "for") {
        if (typeof s.name !== "string" || !/^[\p{L}_][\p{L}\p{N}_]{0,63}$/u.test(s.name) || reserved.has(s.name) || s.kind === "let" && locals.has(s.name))
          throw new ContractError({ code: "TYPE", line: s.line, message: `变量重复或名称无效 ${s.name}` });
        const type = check(s.kind === "let" ? s.value : s.source, scope);
        if (s.kind === "let") locals.add(s.name);
        if (s.kind === "let") scope.set(s.name, type);
        else {
          if (!["strings", "numbers", "booleans", "pairs"].includes(type))
            throw new ContractError({ code: "TYPE", line: s.line, message: `for 需要词库、集合或 range` });
          const child = new Map(scope);
          child.set(s.name, type.slice(0, -1));
          block(s.body, child, depth + 1);
        }
      } else if (s.kind === "if") {
        if (check(s.test, scope) !== "boolean")
          throw new ContractError({ code: "TYPE", line: s.line, message: `if 条件必须为 Boolean` });
        block(s.body, scope, depth + 1);
        block(s.otherwise, scope, depth + 1);
      } else if (s.kind === "emit") {
        if (check(s.value, scope) !== "string")
          throw new ContractError({ code: "TYPE", line: s.line, message: `emit 需要 String` });
        emits++;
      } else throw new Error("未知控制流语句");
    }
  }
  block(program.body, /* @__PURE__ */ new Map(), 0);
  if (!emits) throw new Error("程序需要至少一条 emit 输出");
}
function programResources(program) {
  const ids = /* @__PURE__ */ new Set();
  visitProgramExpressions(program, (e) => {
    if (e.kind === "resource") ids.add(e.id);
    if (e.kind === "call" && ["mapchars", "hanconvert"].includes(e.name)) {
      const index = astSignatures[e.name]?.parameters?.indexOf("mappingId") ?? -1;
      if (index >= 0 && e.args[index]) {
        const ref = e.args[index];
        if (ref.kind !== "literal" || typeof ref.value !== "string") throw new Error("Mapping 引用必须使用固定 ID");
        if (ref.value) ids.add(ref.value);
      }
    }
    if (e.kind === "call" && ["resource", "pairs"].includes(e.name) && e.args[0]?.kind === "literal" && typeof e.args[0].value === "string")
      ids.add(e.args[0].value);
  });
  return [...ids];
}
function visitProgramExpressions(program, visit) {
  function expr(e) {
    visit(e);
    if (e.kind === "binary") {
      expr(e.left);
      expr(e.right);
    }
    if (e.kind === "unary") expr(e.value);
    if (e.kind === "call") e.args.forEach(expr);
    if (e.kind === "list") e.items.forEach(expr);
  }
  function block(body) {
    body.forEach((s) => {
      if (s.kind === "for") {
        expr(s.source);
        block(s.body);
      } else if (s.kind === "if") {
        expr(s.test);
        block(s.body);
        block(s.otherwise);
      } else expr(s.value);
    });
  }
  block(program.body);
}
function validateNodeParameters(n) {
  try {
    normalizeParams(n.op, n.params);
    if (n.op === "program") validateProgram(n.program);
  } catch (error) {
    throw diagnose(error, { nodeId: n.id, operator: n.op, line: n.line });
  }
}
function validateGraph(workflow) {
  try {
    validateWorkflowExtensions(workflow);
    validateSubgraphs(workflow, validateGraphBody);
    validateGraphBody(workflow);
  } catch (error) {
    throw diagnose(error, { code: "TYPE" });
  }
}
function validateGraphBody(workflow, scope) {
  if (!workflow.nodes.length || workflow.nodes.length > 200)
    throw new Error("工作流需要 1–200 个节点");
  if (!scope && workflow.nodes.filter((n) => n.op === "output").length !== 1)
    throw new Error("请保留一个结果输出节点");
  if (scope && (!workflow.nodes.some((n) => n.id === scope.output) || workflow.nodes.some((n) => n.op === "output"))) throw new Error("子图需要明确返回内部节点，不使用结果输出节点");
  const map = new Map(workflow.nodes.map((n) => [n.id, n]));
  if (map.size !== workflow.nodes.length) throw new Error("节点 ID 重复");
  if (workflow.nodes.some(
    (n) => !/^[A-Za-z_]\w{0,63}$/.test(n.id) || ["__proto__", "constructor", "prototype"].includes(n.id)
  ))
    throw new Error("节点 ID 无效或使用了保留名称");
  const done = /* @__PURE__ */ new Set(), visiting = /* @__PURE__ */ new Set();
  function visit(n) {
    if (done.has(n.id)) return;
    if (visiting.has(n.id)) throw new Error("检测到循环连线，请使用无环数据流");
    validateNodeParameters(n);
    validateScopedNode(n, workflow.subgraphs ?? [], scope);
    if (n.inputs.length !== inputCount(n, workflow.subgraphs) || n.inputs.some((x) => !map.has(x)))
      throw new Error(`${operators[n.op].name} 缺少有效输入`);
    visiting.add(n.id);
    n.inputs.forEach((id) => visit(map.get(id)));
    visiting.delete(n.id);
    done.add(n.id);
  }
  workflow.nodes.forEach(visit);
  if (!Number.isSafeInteger(workflow.seed))
    throw new Error("种子需要是有效整数");
  if (!Number.isInteger(workflow.limit) || workflow.limit < 1 || workflow.limit > executionBudget.results)
    throw new Error("结果上限为 1–10,000");
}
function workflowResourceIds(workflow) {
  return [...new Set(allNodes(workflow).flatMap((n) => n.program ? programResources(n.program) : nodeResourceBindings(n.op, normalizeParams(n.op, n.params)).map((b) => b.id)))];
}
function resourceDependencies(r) {
  return r.definition?.type === "dynamic" ? workflowResourceIds(r.definition.workflow) : [];
}
function validateResource(r) {
  if (!r || typeof r.id !== "string" || !r.id || r.id.length > 256 || typeof r.name !== "string" || !r.name.trim() || r.name.length > 100 || !Number.isSafeInteger(r.version) || r.version < 1 || !["word", "character", "symbol", "relation", "mapping"].includes(r.kind)) throw new Error("资源元数据无效");
  const d = r.definition;
  if (!d) {
    if (r.kind === "mapping") throw new Error("Mapping 缺少定义");
    return;
  }
  if (d.format !== 1) throw new Error("资源定义版本不兼容");
  if (d.type === "mapping") {
    if (r.kind !== "mapping") throw new Error("Mapping 类型不匹配");
    parseCharacterMap(d.rules);
  } else if (d.type === "dynamic") {
    if (r.kind !== "word") throw new Error("动态资源输出须为普通候选");
    validateGraph(d.workflow);
    if (JSON.stringify(d.workflow).length > 65536) throw new Error("动态定义超过 64K");
    for (const n of allNodes(d.workflow)) {
      if (n.program) visitProgramExpressions(n.program, (e) => {
        if (e.kind === "call" && ["resource", "pairs"].includes(e.name) && (e.args[0]?.kind !== "literal" || typeof e.args[0].value !== "string")) throw new Error("动态资源依赖必须使用固定 ID");
      });
      if (n.parameterBindings && Object.keys(n.parameterBindings).some((k) => /resourceId|mappingId|slots/.test(k))) throw new Error("动态资源依赖必须使用固定 ID");
    }
  } else throw new Error("未知资源定义");
}
function planResources(roots, catalog) {
  const byId = new Map(catalog.map((r) => [r.id, r]));
  const done = /* @__PURE__ */ new Set(), active = /* @__PURE__ */ new Set(), ordered = [];
  function visit(id, path) {
    if (active.has(id)) throw new ContractError({ code: "RESOURCE", message: `资源循环：${[...path, id].join(" → ")}` });
    if (done.has(id)) return;
    if (path.length >= 12 || done.size + active.size >= 100) throw new ContractError({ code: "BUDGET", message: "资源依赖最多 12 层 / 100 个资源" });
    const r = byId.get(id);
    if (!r) throw new ContractError({ code: "RESOURCE", message: `缺失依赖 ${id}（${path.join(" → ")}）` });
    validateResource(r);
    active.add(id);
    for (const dep of resourceDependencies(r)) visit(dep, [...path, id]);
    active.delete(id);
    done.add(id);
    ordered.push(structuredClone(r));
  }
  roots.forEach((id) => visit(id, []));
  for (const r of ordered) if (r.definition?.type === "dynamic") for (const n of allNodes(r.definition.workflow)) for (const b of nodeResourceBindings(n.op, normalizeParams(n.op, n.params))) {
    const target = byId.get(b.id);
    if (b.mapping ? target.kind !== "mapping" : target.kind === "mapping" || target.kind === "relation" !== b.pair) throw new ContractError({ code: "TYPE", message: `资源 ${r.id} 的依赖 ${b.id} 类型不匹配` });
  }
  const versions = Object.fromEntries(ordered.map((r) => [r.id, r.version]));
  const key = JSON.stringify(["glyphforge-resource", 1, ordered.map((r) => [r.id, r.kind, r.version, r.definition ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
  return { resources: ordered, versions, key };
}
function mergePacks(lists) {
  const map = /* @__PURE__ */ new Map();
  for (const list of lists)
    for (const raw of list) {
      const p = validatePack(raw), key = packKey(p);
      if (map.has(key) && JSON.stringify(map.get(key)) !== JSON.stringify(p))
        throw new Error(`扩展同 ID/版本内容冲突 ${key}`);
      map.set(key, p);
    }
  const packs = [...map.values()];
  validatePacks(packs);
  return packs;
}
function requiredPacks(w) {
  const byKey = new Map((w.extensions ?? []).map((p) => [packKey(p), p])), needed = /* @__PURE__ */ new Map();
  function visit(key) {
    if (needed.has(key)) return;
    const p = byKey.get(key);
    if (!p) throw new Error(`缺失扩展 ${key}`);
    needed.set(key, p);
    p.dependencies.forEach((d) => visit(packKey(d)));
  }
  for (const n of allNodes(w))
    if (n.op === "extension") visit(`${n.params.pack}@${n.params.version}`);
  return [...needed.values()];
}
function workflowPacks(w, resources = []) {
  return mergePacks([
    requiredPacks(w),
    ...resources.flatMap(
      (r) => r.definition?.type === "dynamic" ? [requiredPacks(r.definition.workflow)] : []
    )
  ]);
}
const COMMUNITY_LIMIT = 1024 * 1024;
function publicWorkflow(w) {
  const {
    version,
    id,
    name,
    nodes,
    layout,
    seed,
    limit,
    comments,
    groups,
    subgraphs,
    extensions
  } = w;
  return JSON.parse(
    JSON.stringify({
      version,
      id,
      name,
      nodes,
      layout,
      seed,
      limit,
      comments,
      groups,
      subgraphs,
      extensions
    })
  );
}
function metadata(title, description, tags) {
  if (!title.trim() || title.length > 100 || description.length > 2e3 || tags.length > 8 || tags.some((t) => !/^[\p{L}\p{N}_-]{1,24}$/u.test(t)))
    throw new Error("标题、描述或标签超限（最多 8 个标签）");
  if (/<\/?[a-z!]|javascript:|data:text\/html/i.test(title + description))
    throw new Error("公开描述仅接受纯文本");
  return { title: title.trim(), description, tags: [...new Set(tags)] };
}
function validateCommunityPayload(value) {
  const text = JSON.stringify(value);
  if (!text || new TextEncoder().encode(text).length > COMMUNITY_LIMIT)
    throw new Error("社区快照最多 1 MiB");
  validateSharePayload(value);
  const inspect = (v) => {
    if (typeof v === "string" && /<\s*\/?\s*(script|iframe|object|embed|svg)\b|^\s*javascript:/i.test(v))
      throw new Error("禁止可执行标记");
    if (v && typeof v === "object")
      for (const [k, child] of Object.entries(v)) {
        if ([
          "script",
          "javascript",
          "eval",
          "onclick",
          "onload",
          "communityorigin",
          "favorites",
          "history",
          "generated"
        ].includes(k.toLowerCase()))
          throw new Error("禁止脚本或私有字段");
        inspect(child);
      }
  };
  inspect(value);
  const p = value;
  const allowedWorkflow = [
    "version",
    "id",
    "name",
    "nodes",
    "layout",
    "seed",
    "limit",
    "comments",
    "groups",
    "subgraphs",
    "extensions"
  ];
  if (Object.keys(p.workflow).some((k) => !allowedWorkflow.includes(k)))
    throw new Error("工作流包含非公开字段");
  validateGraph(p.workflow);
  validatePacks(p.packManifest);
  const deps = p.dependencies ?? [];
  if (new Set(deps.map((d) => d.id)).size !== deps.length)
    throw new Error("重复依赖");
  for (const d of deps)
    if (!d || typeof d.id !== "string" || typeof d.name !== "string" || d.name.length > 100 || !Number.isSafeInteger(d.version) || d.version < 1 || !["word", "character", "symbol", "relation", "mapping"].includes(d.kind))
      throw new Error("非法依赖");
  const seen = /* @__PURE__ */ new Set();
  for (const r of p.resources) {
    if (Object.keys(r).some(
      (k) => !["meta", "entries", "relationRows"].includes(k)
    ))
      throw new Error("资源包含无关字段");
    if (Object.keys(r.meta).some(
      (k) => ![
        "id",
        "name",
        "description",
        "kind",
        "definition",
        "color",
        "count",
        "version",
        "updatedAt"
      ].includes(k)
    ))
      throw new Error("资源元数据包含无关字段");
    validateResource(r.meta);
    if (seen.has(r.meta.id) || p.version >= 2 && !deps.some(
      (d) => d.id === r.meta.id && d.kind === r.meta.kind && d.version === r.meta.version
    ))
      throw new Error("快照依赖不匹配");
    seen.add(r.meta.id);
    if (!Array.isArray(r.entries) || r.entries.length > 1e5 || r.entries.some((s) => typeof s !== "string" || s.length > 256))
      throw new Error("词条超限");
    if (r.meta.definition && (r.entries.length || r.relationRows))
      throw new Error("定义不得含物化行");
    if (r.meta.kind === "relation") {
      if (r.entries.length || !Array.isArray(r.relationRows) || r.relationRows.length > 1e5)
        throw new Error("关系行无效");
      r.relationRows.forEach(validatePair);
    } else if (r.relationRows) throw new Error("无关关系行");
  }
  const catalog = deps.map(
    (d) => p.resources.find((r) => r.meta.id === d.id)?.meta ?? {
      ...d,
      description: "",
      color: "green",
      count: 0,
      updatedAt: 0,
      ...d.kind === "mapping" ? {
        definition: {
          format: 1,
          type: "mapping",
          rules: "{}"
        }
      } : {}
    }
  );
  const roots = workflowResourceIds(p.workflow);
  if (p.version >= 2) {
    const plan = planResources(roots, catalog);
    if (plan.resources.length !== deps.length)
      throw new Error("依赖闭包不完整或含无关资源");
  } else if (p.resources.some((r) => !roots.includes(r.meta.id)))
    throw new Error("无关快照");
  const workflows = [
    p.workflow,
    ...p.resources.flatMap(
      (r) => r.meta.definition?.type === "dynamic" ? [r.meta.definition.workflow] : []
    )
  ];
  if (workflows.some(
    (w) => Object.keys(w).some((k) => !allowedWorkflow.includes(k))
  ))
    throw new Error("动态工作流包含非公开字段");
  const nodes = workflows.flatMap(allNodes);
  if (p.version < 3 && p.resources.some((r) => r.meta.kind === "relation"))
    throw new Error("关系资源需要 v3 以上");
  if (p.version < 5 && p.workflow.subgraphs?.length)
    throw new Error("子图需要 v5 以上");
  if (p.version < 6 && p.resources.some((r) => r.meta.definition))
    throw new Error("定义资源需要 v6 以上");
  if (p.operatorVersions && Object.entries(p.operatorVersions).some(
    ([op, v]) => !Object.hasOwn(operators, op) || v !== 1
  ))
    throw new Error("非法算子版本");
  const required = workflowPacks(
    p.workflow,
    p.resources.map((r) => r.meta)
  );
  if (p.version === 7 && JSON.stringify(required) !== JSON.stringify(p.packManifest))
    throw new Error("扩展 manifest 不匹配或包含无关声明");
  for (const n of nodes)
    if (Object.keys(n).some(
      (k) => ![
        "id",
        "op",
        "inputs",
        "params",
        "program",
        "parameterBindings",
        "call",
        "line"
      ].includes(k)
    ))
      throw new Error("节点包含非公开字段");
  if (p.version < 7 && (p.packManifest?.length || workflows.some((w) => w.extensions?.length) || nodes.some((n) => n.op === "extension")))
    throw new Error("扩展需要 v7");
  if (p.version >= 2 && (p.irVersion !== 1 || nodes.some((n) => p.operatorVersions?.[n.op] !== 1)))
    throw new Error("IR/算子版本不兼容");
  if (p.version >= 6 && p.resourceDefinitionVersion !== 1)
    throw new Error("资源协议不兼容");
  return value;
}
async function contentHash(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (n) => n.toString(16).padStart(2, "0")
  ).join("");
}
export {
  COMMUNITY_LIMIT,
  contentHash,
  metadata,
  publicWorkflow,
  validateCommunityPayload
};
