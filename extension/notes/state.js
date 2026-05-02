(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TabOutNotesState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NOTES_STORAGE_KEY = 'tab-out-notes-global-v1';
  const DEFAULT_NOTES_TITLE = '笔记';
  const NOTES_EXPORT_MIME_TYPE = 'text/markdown;charset=utf-8';
  const EMPTY_NOTES_CONTENT = {
    type: 'doc',
    content: [
      { type: 'paragraph' },
    ],
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeNewlines(text) {
    return typeof text === 'string' ? text.replace(/\r\n?/g, '\n') : '';
  }

  function normalizeNotesTitle(title) {
    const cleanedTitle = typeof title === 'string'
      ? title
        .replace(/\.tiptap\.json$/i, '')
        .replace(/\.json$/i, '')
        .replace(/\.markdown$/i, '')
        .replace(/\.md$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
      : '';
    return cleanedTitle || DEFAULT_NOTES_TITLE;
  }

  function isNotesContent(value) {
    return value && typeof value === 'object' && !Array.isArray(value) && value.type === 'doc';
  }

  function normalizeNotesContent(content) {
    return isNotesContent(content) ? cloneJson(content) : cloneJson(EMPTY_NOTES_CONTENT);
  }

  function createEmptyNotesState() {
    return {
      title: DEFAULT_NOTES_TITLE,
      type: 'tiptap',
      content: cloneJson(EMPTY_NOTES_CONTENT),
      updatedAt: nowIso(),
    };
  }

  function normalizeNotesDocument(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      throw new Error('笔记文件无效');
    }

    return {
      title: normalizeNotesTitle(doc.title),
      type: typeof doc.type === 'string' && doc.type ? doc.type : 'tiptap',
      content: normalizeNotesContent(doc.content),
      updatedAt: typeof doc.updatedAt === 'string' && doc.updatedAt ? doc.updatedAt : nowIso(),
    };
  }

  function createTextNode(text, marks) {
    const normalizedText = typeof text === 'string' ? text : '';
    const node = {
      type: 'text',
      text: normalizedText,
    };

    if (Array.isArray(marks) && marks.length) {
      node.marks = marks.map((mark) => ({ type: mark.type }));
    }

    return node;
  }

  function createParagraphNode(text) {
    const content = parseInline(text);
    if (!content.length) {
      return { type: 'paragraph' };
    }

    return {
      type: 'paragraph',
      content,
    };
  }

  function appendMark(nodes, type) {
    return nodes.map((node) => {
      if (!node || node.type !== 'text') return node;

      const marks = Array.isArray(node.marks) ? node.marks.slice() : [];
      if (!marks.some((mark) => mark.type === type)) {
        marks.push({ type });
      }

      return createTextNode(node.text, marks);
    });
  }

  function mergeTextNodes(nodes) {
    const merged = [];

    for (const node of nodes) {
      if (!node) continue;

      const previous = merged[merged.length - 1];
      const prevMarks = JSON.stringify(previous?.marks || []);
      const nextMarks = JSON.stringify(node.marks || []);

      if (previous && previous.type === 'text' && node.type === 'text' && prevMarks === nextMarks) {
        previous.text += node.text;
      } else {
        merged.push(node);
      }
    }

    return merged;
  }

  function parseInline(text) {
    const source = typeof text === 'string' ? text : '';
    const nodes = [];
    let buffer = '';
    let index = 0;

    function flushBuffer() {
      if (!buffer) return;
      nodes.push(createTextNode(buffer));
      buffer = '';
    }

    while (index < source.length) {
      const rest = source.slice(index);

      if (rest.startsWith('\\') && source[index + 1]) {
        buffer += source[index + 1];
        index += 2;
        continue;
      }

      if (rest.startsWith('**')) {
        const end = source.indexOf('**', index + 2);
        if (end > index + 2) {
          flushBuffer();
          nodes.push(...appendMark(parseInline(source.slice(index + 2, end)), 'bold'));
          index = end + 2;
          continue;
        }
      }

      if (rest.startsWith('~~')) {
        const end = source.indexOf('~~', index + 2);
        if (end > index + 2) {
          flushBuffer();
          nodes.push(...appendMark(parseInline(source.slice(index + 2, end)), 'strike'));
          index = end + 2;
          continue;
        }
      }

      if (rest.startsWith('`')) {
        const end = source.indexOf('`', index + 1);
        if (end > index + 1) {
          flushBuffer();
          nodes.push(createTextNode(source.slice(index + 1, end), [{ type: 'code' }]));
          index = end + 1;
          continue;
        }
      }

      if (rest.startsWith('*') || rest.startsWith('_')) {
        const marker = source[index];
        const end = source.indexOf(marker, index + 1);
        if (end > index + 1) {
          flushBuffer();
          nodes.push(...appendMark(parseInline(source.slice(index + 1, end)), 'italic'));
          index = end + 1;
          continue;
        }
      }

      buffer += source[index];
      index += 1;
    }

    flushBuffer();
    return mergeTextNodes(nodes);
  }

  function escapeMarkdownText(text, options = {}) {
    let escaped = typeof text === 'string' ? text : '';
    escaped = escaped
      .replace(/\\/g, '\\\\')
      .replace(/([*_`~])/g, '\\$1');

    if (options.inTable) {
      escaped = escaped.replace(/\|/g, '\\|');
    }

    return escaped;
  }

  function serializeInlineNode(node, options = {}) {
    if (!node || typeof node !== 'object') return '';

    if (node.type === 'hardBreak') {
      return options.inTable ? '<br>' : '  \n';
    }

    if (node.type !== 'text') {
      return extractPlainText(node);
    }

    const marks = Array.isArray(node.marks) ? node.marks.map((mark) => mark.type) : [];
    const hasCode = marks.includes('code');
    let text = hasCode
      ? (typeof node.text === 'string' ? node.text : '').replace(/`/g, '\\`')
      : escapeMarkdownText(node.text, options);

    if (hasCode) {
      text = `\`${text}\``;
    }

    if (marks.includes('bold')) {
      text = `**${text}**`;
    }

    if (marks.includes('italic')) {
      text = `_${text}_`;
    }

    if (marks.includes('strike')) {
      text = `~~${text}~~`;
    }

    return text;
  }

  function serializeInlineContent(content, options = {}) {
    if (!Array.isArray(content) || !content.length) return '';
    return content.map((node) => serializeInlineNode(node, options)).join('');
  }

  function extractPlainText(value) {
    if (!value) return '';

    if (Array.isArray(value)) {
      return value.map((item) => extractPlainText(item)).join('');
    }

    if (value.type === 'text') {
      return typeof value.text === 'string' ? value.text : '';
    }

    if (value.type === 'hardBreak') {
      return '\n';
    }

    return extractPlainText(value.content);
  }

  function normalizeInlineText(text) {
    return normalizeNewlines(extractPlainText(text)).replace(/\s+/g, ' ').trim();
  }

  function serializeBlockText(node) {
    if (!node || typeof node !== 'object') return '';

    if (node.type === 'paragraph' || node.type === 'heading') {
      return serializeInlineContent(node.content || []);
    }

    return normalizeInlineText(node);
  }

  function serializeList(node, depth) {
    const lines = [];
    const items = Array.isArray(node?.content) ? node.content : [];
    const ordered = node?.type === 'orderedList';

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const blocks = Array.isArray(item?.content) ? item.content : [];
      const nestedLists = [];
      const textParts = [];

      for (const block of blocks) {
        if (block?.type === 'bulletList' || block?.type === 'orderedList') {
          nestedLists.push(block);
          continue;
        }

        const text = serializeBlockText(block).trim();
        if (text) {
          textParts.push(text);
        }
      }

      const marker = ordered ? `${index + 1}.` : '-';
      lines.push(`${'  '.repeat(depth)}${marker} ${textParts.join(' ').trim()}`.trimEnd());

      for (const nestedList of nestedLists) {
        const nestedText = serializeList(nestedList, depth + 1);
        if (nestedText) {
          lines.push(nestedText);
        }
      }
    }

    return lines.join('\n');
  }

  function serializeTableCell(node) {
    const parts = [];
    const blocks = Array.isArray(node?.content) ? node.content : [];

    for (const block of blocks) {
      if (block?.type === 'paragraph' || block?.type === 'heading') {
        const text = normalizeInlineText(block.content || []);
        if (text) {
          parts.push(text);
        }
        continue;
      }

      const plainText = normalizeInlineText(block);
      if (plainText) {
        parts.push(plainText);
      }
    }

    return escapeMarkdownText(parts.join(' ').trim(), { inTable: true });
  }

  function serializeTable(node) {
    const rows = Array.isArray(node?.content) ? node.content : [];
    if (!rows.length) return '';

    const headerRow = rows[0];
    const headerCells = Array.isArray(headerRow?.content) ? headerRow.content.map(serializeTableCell) : [];
    if (!headerCells.length) return '';

    const lines = [
      `| ${headerCells.join(' | ')} |`,
      `| ${headerCells.map(() => '---').join(' | ')} |`,
    ];

    for (const row of rows.slice(1)) {
      const cells = Array.isArray(row?.content) ? row.content.map(serializeTableCell) : [];
      if (!cells.length) continue;
      lines.push(`| ${cells.join(' | ')} |`);
    }

    return lines.join('\n');
  }

  function serializeBlockquote(node) {
    const inner = serializeBlocks(Array.isArray(node?.content) ? node.content : []);
    if (!inner) return '> ';
    return inner.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
  }

  function serializeBlockNode(node) {
    if (!node || typeof node !== 'object') return '';

    switch (node.type) {
      case 'paragraph':
        return serializeInlineContent(node.content || []);
      case 'heading':
        return `${'#'.repeat(Math.max(1, Math.min(6, Number(node?.attrs?.level) || 1)))} ${serializeInlineContent(node.content || [])}`.trim();
      case 'bulletList':
      case 'orderedList':
        return serializeList(node, 0);
      case 'blockquote':
        return serializeBlockquote(node);
      case 'codeBlock': {
        const code = extractPlainText(node).replace(/\n+$/, '');
        return `\`\`\`\n${code}\n\`\`\``;
      }
      case 'horizontalRule':
        return '---';
      case 'table':
        return serializeTable(node);
      default:
        return normalizeInlineText(node);
    }
  }

  function serializeBlocks(nodes) {
    const content = Array.isArray(nodes) ? nodes : [];
    return content
      .map((node) => serializeBlockNode(node))
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }

  function parseYamlTitle(rawValue) {
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value) return '';

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      return value.slice(1, -1).trim();
    }

    return value;
  }

  function splitTableRow(line) {
    const source = typeof line === 'string' ? line.trim() : '';
    const stripped = source.replace(/^\|/, '').replace(/\|$/, '');
    const cells = [];
    let current = '';

    for (let index = 0; index < stripped.length; index += 1) {
      const char = stripped[index];
      const previous = stripped[index - 1];

      if (char === '|' && previous !== '\\') {
        cells.push(current.trim().replace(/\\\|/g, '|'));
        current = '';
        continue;
      }

      current += char;
    }

    cells.push(current.trim().replace(/\\\|/g, '|'));
    return cells;
  }

  function isBlankLine(line) {
    return !line || !line.trim();
  }

  function isHeadingLine(line) {
    return /^(#{1,6})\s+/.test(line.trim());
  }

  function isHorizontalRuleLine(line) {
    return /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim());
  }

  function isFenceLine(line) {
    return /^```/.test(line.trim());
  }

  function isBlockquoteLine(line) {
    return /^\s*>\s?/.test(line);
  }

  function parseListLine(line) {
    const match = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    if (!match) return null;

    return {
      indent: match[1].length,
      ordered: /\d+\./.test(match[2]),
      text: match[3].trim(),
    };
  }

  function isTableSeparatorLine(line) {
    const cells = splitTableRow(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  function isTableStart(lines, index) {
    if (index + 1 >= lines.length) return false;

    const header = lines[index]?.trim() || '';
    const separator = lines[index + 1]?.trim() || '';

    if (!header.startsWith('|') || !header.endsWith('|')) return false;
    if (!separator.startsWith('|') || !separator.endsWith('|')) return false;

    return isTableSeparatorLine(separator);
  }

  function parseTable(lines, startIndex) {
    const headerCells = splitTableRow(lines[startIndex]);
    const bodyRows = [];
    let index = startIndex + 2;

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line?.trim() || '';

      if (!trimmed || !trimmed.startsWith('|') || !trimmed.endsWith('|')) {
        break;
      }

      bodyRows.push(splitTableRow(trimmed));
      index += 1;
    }

    const columnCount = headerCells.length;
    const rows = [
      {
        type: 'tableRow',
        content: headerCells.map((cell) => ({
          type: 'tableHeader',
          content: [createParagraphNode(cell)],
        })),
      },
    ];

    for (const row of bodyRows) {
      const normalizedRow = row.slice(0, columnCount);
      while (normalizedRow.length < columnCount) {
        normalizedRow.push('');
      }

      rows.push({
        type: 'tableRow',
        content: normalizedRow.map((cell) => ({
          type: 'tableCell',
          content: [createParagraphNode(cell)],
        })),
      });
    }

    return {
      node: {
        type: 'table',
        content: rows,
      },
      nextIndex: index,
    };
  }

  function parseList(lines, startIndex) {
    const first = parseListLine(lines[startIndex]);
    if (!first) return null;

    const baseIndent = first.indent;
    const listType = first.ordered ? 'orderedList' : 'bulletList';
    const items = [];
    let index = startIndex;

    while (index < lines.length) {
      const info = parseListLine(lines[index]);
      if (!info || info.indent < baseIndent || info.indent !== baseIndent || (info.ordered ? 'orderedList' : 'bulletList') !== listType) {
        break;
      }

      let itemText = info.text;
      const childBlocks = [];
      index += 1;

      while (index < lines.length) {
        if (isBlankLine(lines[index])) {
          index += 1;
          continue;
        }

        const nestedInfo = parseListLine(lines[index]);
        if (nestedInfo && nestedInfo.indent <= baseIndent) {
          break;
        }

        if (nestedInfo && nestedInfo.indent > baseIndent) {
          const nestedList = parseList(lines, index);
          if (nestedList) {
            childBlocks.push(nestedList.node);
            index = nestedList.nextIndex;
            continue;
          }
        }

        if (/^\s+/.test(lines[index])) {
          itemText = `${itemText} ${lines[index].trim()}`.trim();
          index += 1;
          continue;
        }

        break;
      }

      items.push({
        type: 'listItem',
        content: [
          createParagraphNode(itemText),
          ...childBlocks,
        ],
      });
    }

    return {
      node: {
        type: listType,
        content: items,
      },
      nextIndex: index,
    };
  }

  function parseBlockquote(lines, startIndex) {
    const innerLines = [];
    let index = startIndex;

    while (index < lines.length && isBlockquoteLine(lines[index])) {
      innerLines.push(lines[index].replace(/^\s*>\s?/, ''));
      index += 1;
    }

    const innerNodes = parseBlocks(innerLines);
    return {
      node: {
        type: 'blockquote',
        content: innerNodes,
      },
      nextIndex: index,
    };
  }

  function parseCodeBlock(lines, startIndex) {
    const fence = lines[startIndex].trim();
    const marker = fence.slice(0, 3);
    const codeLines = [];
    let index = startIndex + 1;

    while (index < lines.length && !lines[index].trim().startsWith(marker)) {
      codeLines.push(lines[index]);
      index += 1;
    }

    if (index < lines.length) {
      index += 1;
    }

    return {
      node: {
        type: 'codeBlock',
        content: codeLines.length ? [createTextNode(codeLines.join('\n'))] : [],
      },
      nextIndex: index,
    };
  }

  function parseParagraph(lines, startIndex) {
    const parts = [];
    let index = startIndex;

    while (index < lines.length) {
      const line = lines[index];
      if (isBlankLine(line)) break;

      if (index > startIndex) {
        if (
          isHeadingLine(line) ||
          isHorizontalRuleLine(line) ||
          isFenceLine(line) ||
          isBlockquoteLine(line) ||
          parseListLine(line) ||
          isTableStart(lines, index)
        ) {
          break;
        }
      }

      parts.push(line.trim());
      index += 1;
    }

    return {
      node: createParagraphNode(parts.join(' ')),
      nextIndex: index,
    };
  }

  function parseBlocks(lines) {
    const nodes = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line?.trim() || '';

      if (!trimmed) {
        index += 1;
        continue;
      }

      if (isFenceLine(line)) {
        const codeBlock = parseCodeBlock(lines, index);
        nodes.push(codeBlock.node);
        index = codeBlock.nextIndex;
        continue;
      }

      if (isTableStart(lines, index)) {
        const table = parseTable(lines, index);
        nodes.push(table.node);
        index = table.nextIndex;
        continue;
      }

      if (isHeadingLine(line)) {
        const match = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (match) {
          nodes.push({
            type: 'heading',
            attrs: { level: match[1].length },
            content: parseInline(match[2].trim()),
          });
          index += 1;
          continue;
        }
      }

      if (isHorizontalRuleLine(line)) {
        nodes.push({ type: 'horizontalRule' });
        index += 1;
        continue;
      }

      if (isBlockquoteLine(line)) {
        const blockquote = parseBlockquote(lines, index);
        nodes.push(blockquote.node);
        index = blockquote.nextIndex;
        continue;
      }

      if (parseListLine(line)) {
        const list = parseList(lines, index);
        if (list) {
          nodes.push(list.node);
          index = list.nextIndex;
          continue;
        }
      }

      const paragraph = parseParagraph(lines, index);
      nodes.push(paragraph.node);
      index = paragraph.nextIndex;
    }

    return nodes;
  }

  function parseMarkdownDocument(markdown) {
    const text = normalizeNewlines(markdown);
    const lines = text.split('\n');
    let index = 0;
    let title = '';

    if (lines[0]?.trim() === '---') {
      index = 1;

      while (index < lines.length && lines[index].trim() !== '---') {
        const match = lines[index].match(/^title:\s*(.*)$/i);
        if (match) {
          title = parseYamlTitle(match[1]);
        }
        index += 1;
      }

      if (index < lines.length && lines[index].trim() === '---') {
        index += 1;
      } else {
        index = 0;
        title = '';
      }
    }

    while (index < lines.length && isBlankLine(lines[index])) {
      index += 1;
    }

    return {
      title,
      content: parseBlocks(lines.slice(index)),
    };
  }

  function exportNotesDocument(doc) {
    const normalized = normalizeNotesDocument(doc);
    const body = serializeBlocks(normalized.content?.content || []);
    const frontmatter = [
      '---',
      `title: ${normalized.title}`,
      '---',
    ].join('\n');

    return body ? `${frontmatter}\n\n${body}\n` : `${frontmatter}\n`;
  }

  function importNotesDocument(text, options = {}) {
    const normalizedText = normalizeNewlines(text);
    if (!normalizedText.trim()) {
      throw new Error('笔记文件为空');
    }

    const parsed = parseMarkdownDocument(normalizedText);
    if (!Array.isArray(parsed.content) || !parsed.content.length) {
      throw new Error('笔记文件无效');
    }

    return normalizeNotesDocument({
      title: parsed.title || options.title,
      type: 'tiptap',
      content: {
        type: 'doc',
        content: parsed.content,
      },
      updatedAt: nowIso(),
    });
  }

  return {
    NOTES_STORAGE_KEY,
    DEFAULT_NOTES_TITLE,
    NOTES_EXPORT_MIME_TYPE,
    EMPTY_NOTES_CONTENT,
    createEmptyNotesState,
    normalizeNotesDocument,
    exportNotesDocument,
    importNotesDocument,
  };
});
