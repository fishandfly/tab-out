(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TabOutStructureboardState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STRUCTUREBOARD_STORAGE_KEY = 'tab-out-structureboard-global-v1';
  const DEFAULT_STRUCTUREBOARD_TITLE = '结构图';
  const EMPTY_STRUCTUREBOARD_XML = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" version="24.7.17">
  <diagram id="tabout-structure" name="Page-1">
    <mxGraphModel dx="1280" dy="720" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1200" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeStructureboardTitle(title) {
    const cleanedTitle = typeof title === 'string'
      ? title.replace(/\.drawio$/i, '').replace(/\.xml$/i, '').replace(/\s+/g, ' ').trim()
      : '';
    return cleanedTitle || DEFAULT_STRUCTUREBOARD_TITLE;
  }

  function isStructureboardXml(text) {
    return typeof text === 'string' && /<mxfile[\s>]/i.test(text);
  }

  function normalizeStructureboardXml(xml) {
    return isStructureboardXml(xml) ? xml.trim() : EMPTY_STRUCTUREBOARD_XML;
  }

  function createEmptyStructureboardState() {
    return {
      title: DEFAULT_STRUCTUREBOARD_TITLE,
      type: 'drawio',
      xml: EMPTY_STRUCTUREBOARD_XML,
      updatedAt: nowIso(),
    };
  }

  function normalizeStructureboardDocument(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      throw new Error('结构图文件无效');
    }

    return {
      title: normalizeStructureboardTitle(doc.title),
      type: typeof doc.type === 'string' && doc.type ? doc.type : 'drawio',
      xml: normalizeStructureboardXml(doc.xml),
      updatedAt: typeof doc.updatedAt === 'string' && doc.updatedAt ? doc.updatedAt : nowIso(),
    };
  }

  function exportStructureboardDocument(doc) {
    return normalizeStructureboardDocument(doc).xml;
  }

  function importStructureboardDocument(text, options = {}) {
    if (!isStructureboardXml(text)) {
      throw new Error('结构图文件无法解析');
    }

    return normalizeStructureboardDocument({
      title: options.title,
      type: 'drawio',
      xml: text,
      updatedAt: nowIso(),
    });
  }

  return {
    STRUCTUREBOARD_STORAGE_KEY,
    DEFAULT_STRUCTUREBOARD_TITLE,
    EMPTY_STRUCTUREBOARD_XML,
    createEmptyStructureboardState,
    normalizeStructureboardDocument,
    exportStructureboardDocument,
    importStructureboardDocument,
  };
});
