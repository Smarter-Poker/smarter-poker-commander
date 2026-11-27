#!/usr/bin/env node
/**
 * scripts/ci/check-module-parse-and-bindings.mjs
 *
 * Permanent Vercel-build safety gate for Smarter-Poker Commander
 * (ported from World Hub incident 86bcafc1 / VercelDeploymentFailed).
 *
 * Parses application source modules with the locked TypeScript Compiler API
 * (`typescript` in devDependencies — zero extra dependencies) and catches
 * seven classes of production Next.js/Vercel build failures in one pass:
 *   1. Syntax errors, duplicate import bindings, duplicate top-level & block
 *      lexical declarations, and duplicate named or default exports across
 *      .js/.jsx/.mjs/.cjs/.ts/.tsx.
 *   2. Missing, untracked, or Linux case-mismatched local relative & `@/*`
 *      path-alias imports/re-exports (honoring tsconfig.json `paths`).
 *   3. Broken or case-mismatched dynamic `import('...')` and `require('...')`
 *      local/`@/` paths.
 *   4. Missing named or default exports from local/`@/` static ESM modules.
 *   5. Next.js route collisions (same-basename different extensions in pages/,
 *      or pages/ colliding with app/.../page.*) and page-level invariants
 *      (`getStaticProps`+`getServerSideProps`, `getStaticPaths` without
 *      `getStaticProps`, `next/document` outside `_document`, local global CSS
 *      outside `_app`/`app/`).
 *   6. Invalid JSON in critical config files (`vercel.json`, `package.json`,
 *      `package-lock.json`, `tsconfig.json`, `jsconfig.json`, `config/*.json`)
 *      and any imported `.json` data files.
 *   7. Cross-PR merge regressions under strict:false branch protection: when
 *      `--merge-against <baseRef>` is passed and HEAD is behind `<baseRef>`,
 *      runs read-only `git merge-tree --write-tree <baseRef> HEAD` and validates
 *      the exact merged tree before merge so two independently-green PRs cannot
 *      combine into a SyntaxError or broken config on main.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export const SOURCE_ROOTS = ['pages', 'app', 'src', 'vendor/commander-shared/src'];
export const ROOT_ENTRY_FILES = new Set([
  'middleware.ts',
  'middleware.js',
  'middleware.mjs',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
]);
export const MODULE_EXT_RE = /\.(js|jsx|mjs|cjs|ts|tsx)$/;
export const CRITICAL_CONFIG_JSON_RE =
  /^(?:vercel|package|package-lock|tsconfig|jsconfig)\.json$|^config\/.*\.json$/;

const RESOLVE_EXTS = [
  '',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.json',
  '/index.js',
  '/index.jsx',
  '/index.ts',
  '/index.tsx',
  '/index.mjs',
  '/index.cjs',
];
const ASSET_EXT_RE =
  /\.(css|scss|sass|less|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|eot|mp4|mp3|wav|pdf|txt|md|wasm)$/i;
const STYLESHEET_EXT_RE = /\.(css|scss|sass|less)$/i;
const CSS_MODULE_EXT_RE = /\.module\.(css|scss|sass|less)$/i;
const DEFAULT_ALIAS_MAP = new Map([['@/', ['src/', '']]]);

let cachedTs = null;
function getTypeScript(resolveFromDir) {
  if (resolveFromDir) {
    try {
      const localRequire = createRequire(path.join(resolveFromDir, 'package.json'));
      return localRequire('typescript');
    } catch {
      // Fall through to the gate's own installed TypeScript (e.g. isolated temp git fixtures).
    }
  }
  if (!cachedTs) {
    cachedTs = require('typescript');
  }
  return cachedTs;
}

export function loadAliasMapFromTsconfig(allTrackedFiles, readFile) {
  if (!allTrackedFiles.includes('tsconfig.json')) {
    return DEFAULT_ALIAS_MAP;
  }
  try {
    const raw = readFile('tsconfig.json');
    const parsed = JSON.parse(raw);
    const pathsCfg = parsed?.compilerOptions?.paths;
    if (!pathsCfg || typeof pathsCfg !== 'object') {
      return DEFAULT_ALIAS_MAP;
    }
    const map = new Map();
    for (const [pattern, targets] of Object.entries(pathsCfg)) {
      if (!pattern.endsWith('/*') || !Array.isArray(targets)) continue;
      const keyPrefix = pattern.slice(0, -1); // e.g. "@/"
      const normalizedTargets = [];
      for (const t of targets) {
        if (typeof t !== 'string' || !t.endsWith('*')) continue;
        let prefix = t.slice(0, -1).replace(/^\.\//, '');
        if (prefix && !prefix.endsWith('/')) prefix += '/';
        normalizedTargets.push(prefix);
      }
      if (normalizedTargets.length > 0) {
        map.set(keyPrefix, normalizedTargets);
      }
    }
    return map.size > 0 ? map : DEFAULT_ALIAS_MAP;
  } catch {
    return DEFAULT_ALIAS_MAP;
  }
}

function matchAliasPrefix(spec, aliasMap) {
  if (typeof spec !== 'string') return null;
  for (const [prefix, targets] of aliasMap.entries()) {
    if (spec.startsWith(prefix)) {
      return { prefix, targets };
    }
  }
  return null;
}

function isLocalOrAliasSpec(spec, aliasMap = DEFAULT_ALIAS_MAP) {
  return (
    typeof spec === 'string' &&
    (spec.startsWith('./') || spec.startsWith('../') || matchAliasPrefix(spec, aliasMap) !== null)
  );
}

function getScriptKind(ts, filePath) {
  if (/\.tsx$/.test(filePath)) return ts.ScriptKind.TSX;
  if (/\.ts$/.test(filePath)) return ts.ScriptKind.TS;
  if (/\.cjs$/.test(filePath)) return ts.ScriptKind.JS;
  // Next.js allows JSX inside .js/.jsx/.mjs files.
  return ts.ScriptKind.JSX;
}

function lineOf(sourceFile, pos) {
  const safePos = typeof pos === 'number' && pos >= 0 ? Math.min(pos, sourceFile.text.length) : 0;
  return sourceFile.getLineAndCharacterOfPosition(safePos).line + 1;
}

function hasModifier(ts, node, kind) {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : node.modifiers;
  return Array.isArray(mods) && mods.some((m) => m.kind === kind);
}

function collectBindingNames(ts, nameNode, sourceFile, out) {
  if (!nameNode) return;
  if (ts.isIdentifier(nameNode)) {
    out.push({ name: nameNode.text, line: lineOf(sourceFile, nameNode.getStart(sourceFile)) });
  } else if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
    for (const el of nameNode.elements) {
      if (ts.isBindingElement(el)) {
        collectBindingNames(ts, el.name, sourceFile, out);
      }
    }
  }
}

export function parseModuleAst(filePath, source, { tsLib, resolveFromDir } = {}) {
  const ts = tsLib || getTypeScript(resolveFromDir);
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(ts, filePath),
  );

  const diagnostics = Array.isArray(sourceFile.parseDiagnostics) ? sourceFile.parseDiagnostics : [];
  if (diagnostics.length > 0) {
    const first = diagnostics[0];
    const start = typeof first.start === 'number' ? first.start : 0;
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
    const msg = ts.flattenDiagnosticMessageText(first.messageText, ' ');
    const err = new Error(msg);
    err.loc = { line: line + 1, column: character };
    throw err;
  }

  return { sourceFile, ts };
}

export function extractModuleSurface(
  filePath,
  source,
  parsed,
  { aliasMap = DEFAULT_ALIAS_MAP } = {},
) {
  const { sourceFile, ts } = parsed;
  const isCJS = /\.cjs$/.test(filePath);
  const valueExports = new Set();
  const typeExports = new Set();
  const duplicateBindings = [];
  const duplicateExports = [];
  const topLevelBindings = new Map();
  let defaultExportCount = 0;
  let hasDefault = false;
  let hasStarReExport = false;
  let isDynamicCjs =
    isCJS || /\bmodule\.exports\b|\bexports\s*[.[]|\bObject\.defineProperty\(\s*exports\b/.test(source);

  const relativeImports = [];
  const relativeNamedImports = [];
  const relativeDefaultImports = [];
  const nextDocumentImports = [];
  const localGlobalCssImports = [];

  const recordTopLevelBinding = (name, kind, line) => {
    if (!name) return;
    const prev = topLevelBindings.get(name);
    if (prev) {
      // `var` + `var` redeclaration is valid JS; any lexical/import/function collision is a SyntaxError in ESM/SWC.
      if (prev.kind === 'var' && kind === 'var') {
        return;
      }
      // In CJS script mode, duplicate top-level function declarations are legal unless colliding with lexical/import.
      if (isCJS && prev.kind === 'function' && kind === 'function') {
        return;
      }
      duplicateBindings.push({
        name,
        line,
        previousLine: prev.line,
        message: `Identifier '${name}' has already been declared (line ${line}, previous at line ${prev.line})`,
      });
    } else {
      topLevelBindings.set(name, { kind, line });
    }
  };

  const recordValueExport = (name, line) => {
    if (!name) return;
    if (valueExports.has(name)) {
      duplicateExports.push({ name, line });
    } else {
      valueExports.add(name);
    }
  };

  const recordDefaultExport = (line) => {
    hasDefault = true;
    defaultExportCount += 1;
    if (defaultExportCount > 1) {
      duplicateExports.push({ name: 'default', line });
    }
  };

  for (const stmt of sourceFile.statements) {
    const stmtLine = lineOf(sourceFile, stmt.getStart(sourceFile));
    const isAmbient = hasModifier(ts, stmt, ts.SyntaxKind.DeclareKeyword);
    const isExported = hasModifier(ts, stmt, ts.SyntaxKind.ExportKeyword);
    const isDefaultMod = hasModifier(ts, stmt, ts.SyntaxKind.DefaultKeyword);

    if (ts.isImportDeclaration(stmt)) {
      const clause = stmt.importClause;
      if (clause?.isTypeOnly) continue;
      if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const spec = stmt.moduleSpecifier.text;

      if (spec === 'next/document') {
        nextDocumentImports.push({ spec, line: stmtLine });
      }
      if (
        isLocalOrAliasSpec(spec, aliasMap) &&
        STYLESHEET_EXT_RE.test(spec) &&
        !CSS_MODULE_EXT_RE.test(spec)
      ) {
        localGlobalCssImports.push({ spec, line: stmtLine });
      }

      const localSpec = isLocalOrAliasSpec(spec, aliasMap);
      if (localSpec) {
        relativeImports.push({ spec, line: stmtLine, kind: 'static' });
      }

      if (clause) {
        if (clause.name) {
          const defLine = lineOf(sourceFile, clause.name.getStart(sourceFile));
          recordTopLevelBinding(clause.name.text, 'import', defLine);
          if (localSpec) {
            relativeDefaultImports.push({ spec, line: defLine });
          }
        }
        const bindings = clause.namedBindings;
        if (bindings) {
          if (ts.isNamespaceImport(bindings)) {
            const nsLine = lineOf(sourceFile, bindings.name.getStart(sourceFile));
            recordTopLevelBinding(bindings.name.text, 'import', nsLine);
          } else if (ts.isNamedImports(bindings)) {
            const names = [];
            for (const el of bindings.elements) {
              if (el.isTypeOnly) continue;
              const elLine = lineOf(sourceFile, el.getStart(sourceFile));
              recordTopLevelBinding(el.name.text, 'import', elLine);
              if (localSpec) {
                const imported = el.propertyName ? el.propertyName.text : el.name.text;
                if (imported === 'default') {
                  relativeDefaultImports.push({ spec, line: elLine });
                } else if (imported) {
                  names.push({ imported, line: elLine });
                }
              }
            }
            if (localSpec && names.length > 0) {
              relativeNamedImports.push({ spec, names });
            }
          }
        }
      }
    } else if (ts.isExportAssignment(stmt)) {
      if (stmt.isExportEquals) {
        isDynamicCjs = true;
      } else {
        recordDefaultExport(stmtLine);
      }
    } else if (ts.isExportDeclaration(stmt)) {
      const spec =
        stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : null;
      const localSpec = spec !== null && isLocalOrAliasSpec(spec, aliasMap);

      if (!stmt.isTypeOnly && localSpec) {
        relativeImports.push({ spec, line: stmtLine, kind: 're-export' });
      }

      if (!stmt.exportClause) {
        if (!stmt.isTypeOnly) {
          hasStarReExport = true;
        }
      } else if (ts.isNamespaceExport(stmt.exportClause)) {
        const nsName = stmt.exportClause.name.text;
        if (stmt.isTypeOnly) {
          typeExports.add(nsName);
        } else {
          recordValueExport(nsName, lineOf(sourceFile, stmt.exportClause.name.getStart(sourceFile)));
        }
      } else if (ts.isNamedExports(stmt.exportClause)) {
        const reExportNames = [];
        for (const el of stmt.exportClause.elements) {
          const elLine = lineOf(sourceFile, el.getStart(sourceFile));
          const exported = el.name.text;
          const localOrImported = el.propertyName ? el.propertyName.text : el.name.text;
          if (stmt.isTypeOnly || el.isTypeOnly) {
            typeExports.add(exported);
          } else {
            if (exported === 'default') {
              recordDefaultExport(elLine);
            } else {
              recordValueExport(exported, elLine);
            }
            if (localSpec) {
              if (localOrImported === 'default') {
                relativeDefaultImports.push({ spec, line: elLine });
              } else {
                reExportNames.push({ imported: localOrImported, line: elLine });
              }
            }
          }
        }
        if (localSpec && reExportNames.length > 0) {
          relativeNamedImports.push({ spec, names: reExportNames });
        }
      }
    } else if (ts.isVariableStatement(stmt)) {
      if (isAmbient) continue;
      const flags = stmt.declarationList.flags;
      const kind =
        (flags & ts.NodeFlags.Const) !== 0
          ? 'const'
          : (flags & ts.NodeFlags.Let) !== 0
            ? 'let'
            : 'var';
      for (const decl of stmt.declarationList.declarations) {
        const names = [];
        collectBindingNames(ts, decl.name, sourceFile, names);
        for (const { name, line } of names) {
          recordTopLevelBinding(name, kind, line);
          if (isExported) {
            recordValueExport(name, line);
          }
        }
      }
    } else if (ts.isFunctionDeclaration(stmt)) {
      if (isAmbient || !stmt.body) continue;
      if (stmt.name) {
        recordTopLevelBinding(stmt.name.text, 'function', lineOf(sourceFile, stmt.name.getStart(sourceFile)));
      }
      if (isExported) {
        if (isDefaultMod) {
          recordDefaultExport(stmtLine);
        } else if (stmt.name) {
          recordValueExport(stmt.name.text, lineOf(sourceFile, stmt.name.getStart(sourceFile)));
        }
      }
    } else if (ts.isClassDeclaration(stmt)) {
      if (isAmbient) continue;
      if (stmt.name) {
        recordTopLevelBinding(stmt.name.text, 'class', lineOf(sourceFile, stmt.name.getStart(sourceFile)));
      }
      if (isExported) {
        if (isDefaultMod) {
          recordDefaultExport(stmtLine);
        } else if (stmt.name) {
          recordValueExport(stmt.name.text, lineOf(sourceFile, stmt.name.getStart(sourceFile)));
        }
      }
    } else if (ts.isEnumDeclaration(stmt)) {
      if (isAmbient) continue;
      const enumLine = lineOf(sourceFile, stmt.name.getStart(sourceFile));
      recordTopLevelBinding(stmt.name.text, 'enum', enumLine);
      if (isExported) {
        recordValueExport(stmt.name.text, enumLine);
      }
    } else if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
      if (isExported && stmt.name) {
        typeExports.add(stmt.name.text);
      }
    }
  }

  // Walk full AST for:
  //  - Dynamic import('...') and CommonJS require('...') with static local/@/ string literals
  //  - Duplicate lexical bindings (const/let/class) inside nested blocks
  const walk = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const firstArg = node.arguments[0];
      if (ts.isStringLiteralLike(firstArg)) {
        const spec = firstArg.text;
        if (isLocalOrAliasSpec(spec, aliasMap)) {
          const callLine = lineOf(sourceFile, node.getStart(sourceFile));
          if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            relativeImports.push({ spec, line: callLine, kind: 'dynamic-import' });
          } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
            relativeImports.push({ spec, line: callLine, kind: 'require' });
          }
        }
      }
    }

    if (ts.isBlock(node)) {
      const blockLexical = new Map();
      for (const s of node.statements) {
        if (ts.isVariableStatement(s)) {
          const flags = s.declarationList.flags;
          const isLexical = (flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) !== 0;
          if (!isLexical) continue;
          for (const decl of s.declarationList.declarations) {
            const names = [];
            collectBindingNames(ts, decl.name, sourceFile, names);
            for (const { name, line } of names) {
              const prevLine = blockLexical.get(name);
              if (prevLine !== undefined) {
                duplicateBindings.push({
                  name,
                  line,
                  previousLine: prevLine,
                  message: `Identifier '${name}' has already been declared in block scope (line ${line}, previous at line ${prevLine})`,
                });
              } else {
                blockLexical.set(name, line);
              }
            }
          }
        } else if (ts.isClassDeclaration(s) && s.name) {
          const name = s.name.text;
          const line = lineOf(sourceFile, s.name.getStart(sourceFile));
          const prevLine = blockLexical.get(name);
          if (prevLine !== undefined) {
            duplicateBindings.push({
              name,
              line,
              previousLine: prevLine,
              message: `Identifier '${name}' has already been declared in block scope (line ${line}, previous at line ${prevLine})`,
            });
          } else {
            blockLexical.set(name, line);
          }
        }
      }
    }

    ts.forEachChild(node, walk);
  };
  walk(sourceFile);

  return {
    valueExports,
    typeExports,
    duplicateBindings,
    duplicateExports,
    hasDefault,
    hasStarReExport,
    isDynamicCjs,
    relativeImports,
    relativeNamedImports,
    relativeDefaultImports,
    nextDocumentImports,
    localGlobalCssImports,
  };
}

export function resolveTrackedTarget(fromFile, spec, trackedSet, aliasMap = DEFAULT_ALIAS_MAP) {
  const aliasMatch = matchAliasPrefix(spec, aliasMap);
  const candidateBases = aliasMatch
    ? aliasMatch.targets.map((targetPrefix) =>
        path.posix.normalize(targetPrefix + spec.slice(aliasMatch.prefix.length)),
      )
    : [path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec))];

  for (const relBase of candidateBases) {
    if (ASSET_EXT_RE.test(spec)) {
      if (trackedSet.has(relBase)) return relBase;
      continue;
    }
    for (const ext of RESOLVE_EXTS) {
      const candidate = relBase + ext;
      if (trackedSet.has(candidate)) return candidate;
    }
  }
  return null;
}

export function findNextRouteCollisions(trackedFiles) {
  const violations = [];

  // 1. Same-basename different extensions inside pages/ (e.g. pages/foo.js + pages/foo.tsx)
  const baseMap = new Map();
  for (const file of trackedFiles) {
    if (!file.startsWith('pages/') || !MODULE_EXT_RE.test(file)) continue;
    const noExt = file.replace(/\.(js|jsx|ts|tsx|mjs|cjs)$/, '');
    if (!baseMap.has(noExt)) baseMap.set(noExt, []);
    baseMap.get(noExt).push(file);
  }
  for (const [base, group] of baseMap) {
    if (group.length > 1) {
      violations.push({
        kind: 'route-extension-collision',
        file: group[0],
        message: `Multiple Next.js pages share basename "${base}": ${group.sort().join(', ')}`,
      });
    }
  }

  // 2. pages/ route colliding with app/.../page.*
  const appRoutes = new Map();
  for (const file of trackedFiles) {
    if (!file.startsWith('app/')) continue;
    if (!/^app\/(?:.*\/)?page\.(js|jsx|ts|tsx)$/.test(file)) continue;
    const route = file.replace(/^app/, '').replace(/\/page\.(js|jsx|ts|tsx)$/, '') || '/';
    appRoutes.set(route, file);
  }
  for (const file of trackedFiles) {
    if (!file.startsWith('pages/') || file.startsWith('pages/api/') || !MODULE_EXT_RE.test(file)) {
      continue;
    }
    let rel = file.slice('pages/'.length).replace(/\.(js|jsx|ts|tsx|mjs|cjs)$/, '');
    if (['_app', '_document', '_error', '404', '500'].includes(rel)) continue;
    if (rel.endsWith('/index')) rel = rel.slice(0, -'/index'.length);
    if (rel === 'index') rel = '';
    const route = '/' + rel;
    if (appRoutes.has(route)) {
      violations.push({
        kind: 'app-pages-route-collision',
        file,
        message: `Conflicting pages/ and app/ route "${route}": ${file} vs ${appRoutes.get(route)}`,
      });
    }
  }

  return violations;
}

/**
 * Validate a virtual or real repository tree.
 *
 * @param {object} params
 * @param {string[]} params.allTrackedFiles - All tracked file paths (POSIX) for exact-case import & route resolution.
 * @param {(filePath: string) => string} params.readFile - Reads UTF-8 source of a tracked file.
 * @param {string[]|null} [params.onlyCheckFiles] - Optional subset of module paths to check (still resolves targets across allTrackedFiles).
 * @param {object} [params.tsLib] - Optional TypeScript compiler module override.
 */
export function validateModuleTree({
  allTrackedFiles,
  readFile,
  onlyCheckFiles = null,
  tsLib,
  resolveFromDir,
}) {
  const trackedSet = new Set(allTrackedFiles);
  const aliasMap = loadAliasMapFromTsconfig(allTrackedFiles, readFile);
  const violations = [...findNextRouteCollisions(allTrackedFiles)];

  const isScannedModule = (f) =>
    MODULE_EXT_RE.test(f) &&
    (ROOT_ENTRY_FILES.has(f) || SOURCE_ROOTS.some((root) => f.startsWith(`${root}/`)));

  const isDirectModule = (f) =>
    MODULE_EXT_RE.test(f) && !f.startsWith('node_modules/') && !f.startsWith('.next/');

  const modulesToCheck = onlyCheckFiles
    ? onlyCheckFiles.filter((f) => trackedSet.has(f) && isDirectModule(f))
    : allTrackedFiles.filter(isScannedModule);

  const jsonFilesToCheck = new Set(
    (onlyCheckFiles ? onlyCheckFiles.filter((f) => trackedSet.has(f)) : allTrackedFiles).filter((f) =>
      CRITICAL_CONFIG_JSON_RE.test(f),
    ),
  );

  const surfaceCache = new Map();
  const parseAndCache = (filePath) => {
    if (surfaceCache.has(filePath)) return surfaceCache.get(filePath);
    let source;
    try {
      source = readFile(filePath);
    } catch (err) {
      surfaceCache.set(filePath, null);
      violations.push({
        kind: 'read-error',
        file: filePath,
        message: err.message,
      });
      return null;
    }
    try {
      const parsed = parseModuleAst(filePath, source, { tsLib, resolveFromDir });
      const surface = extractModuleSurface(filePath, source, parsed, { aliasMap });
      surfaceCache.set(filePath, surface);
      return surface;
    } catch (err) {
      surfaceCache.set(filePath, null);
      const loc = err.loc ? ` (line ${err.loc.line}, col ${err.loc.column})` : '';
      violations.push({
        kind: 'parse-or-binding-error',
        file: filePath,
        message: `${err.message}${loc}`,
      });
      return null;
    }
  };

  for (const filePath of modulesToCheck) {
    parseAndCache(filePath);
  }

  for (const filePath of modulesToCheck) {
    const surface = surfaceCache.get(filePath);
    if (!surface) continue;

    // 1a. Duplicate bindings (imports, top-level & block lexical declarations)
    for (const dup of surface.duplicateBindings) {
      violations.push({
        kind: 'parse-or-binding-error',
        file: filePath,
        line: dup.line,
        message: dup.message,
      });
    }

    // 1b. Explicit duplicate export check (named & default exports)
    for (const dup of surface.duplicateExports) {
      violations.push({
        kind: 'parse-or-binding-error',
        file: filePath,
        line: dup.line,
        message: `Duplicate export "${dup.name}" (line ${dup.line})`,
      });
    }

    // 2. Case-exact relative & @/* alias import / re-export / dynamic import / require resolution
    for (const imp of surface.relativeImports) {
      const target = resolveTrackedTarget(filePath, imp.spec, trackedSet, aliasMap);
      if (!target) {
        const label =
          imp.kind === 'dynamic-import'
            ? 'Dynamic import'
            : imp.kind === 'require'
              ? 'require()'
              : matchAliasPrefix(imp.spec, aliasMap)
                ? 'Alias import'
                : 'Relative import';
        violations.push({
          kind: 'broken-or-case-mismatched-import',
          file: filePath,
          line: imp.line,
          message: `${label} "${imp.spec}" (line ${imp.line}) does not match any tracked file with exact case`,
        });
      } else if (target.endsWith('.json')) {
        jsonFilesToCheck.add(target);
      }
    }

    // 3. Local & @/* static ESM named-export parity
    const importerIsTS = /\.(ts|tsx)$/.test(filePath);
    for (const group of surface.relativeNamedImports) {
      const target = resolveTrackedTarget(filePath, group.spec, trackedSet, aliasMap);
      if (!target || !MODULE_EXT_RE.test(target) || ASSET_EXT_RE.test(target)) continue;
      const targetSurface = parseAndCache(target);
      if (!targetSurface || targetSurface.isDynamicCjs || targetSurface.hasStarReExport) continue;

      for (const { imported, line } of group.names) {
        const hasValue = targetSurface.valueExports.has(imported);
        const hasType = importerIsTS && targetSurface.typeExports.has(imported);
        if (!hasValue && !hasType) {
          violations.push({
            kind: 'missing-local-named-export',
            file: filePath,
            line,
            message: `Named import "${imported}" from "${group.spec}" (line ${line}) is not exported by ${target}`,
          });
        }
      }
    }

    // 3b. Local & @/* static ESM default-export parity
    for (const defImp of surface.relativeDefaultImports) {
      const target = resolveTrackedTarget(filePath, defImp.spec, trackedSet, aliasMap);
      if (!target || !MODULE_EXT_RE.test(target) || ASSET_EXT_RE.test(target)) continue;
      const targetSurface = parseAndCache(target);
      if (!targetSurface || targetSurface.isDynamicCjs || targetSurface.hasStarReExport) continue;
      if (!targetSurface.hasDefault) {
        violations.push({
          kind: 'missing-local-default-export',
          file: filePath,
          line: defImp.line,
          message: `Default import from "${defImp.spec}" (line ${defImp.line}) has no default export in ${target}`,
        });
      }
    }

    // 4. Next.js build-time page & stylesheet invariants
    if (filePath.startsWith('pages/') && !filePath.startsWith('pages/api/')) {
      if (surface.valueExports.has('getStaticProps') && surface.valueExports.has('getServerSideProps')) {
        violations.push({
          kind: 'next-page-data-method-conflict',
          file: filePath,
          message: 'Next.js page cannot export both getStaticProps and getServerSideProps',
        });
      }
      if (surface.valueExports.has('getStaticPaths') && !surface.valueExports.has('getStaticProps')) {
        violations.push({
          kind: 'next-page-static-paths-without-props',
          file: filePath,
          message: 'Next.js page exports getStaticPaths without getStaticProps',
        });
      }
    }

    if (!/^pages\/_document\.(js|jsx|ts|tsx)$/.test(filePath)) {
      for (const docImp of surface.nextDocumentImports) {
        violations.push({
          kind: 'next-document-import-outside-document',
          file: filePath,
          line: docImp.line,
          message: `next/document cannot be imported outside pages/_document.* (line ${docImp.line})`,
        });
      }
    }

    if (!/^pages\/_app\.(js|jsx|ts|tsx)$/.test(filePath) && !filePath.startsWith('app/')) {
      for (const cssImp of surface.localGlobalCssImports) {
        violations.push({
          kind: 'next-global-css-outside-app',
          file: filePath,
          line: cssImp.line,
          message: `Global CSS "${cssImp.spec}" (line ${cssImp.line}) cannot be imported outside pages/_app.* (use *.module.css)`,
        });
      }
    }
  }

  // 5. Critical config & imported JSON parse validation
  for (const jsonPath of jsonFilesToCheck) {
    try {
      const raw = readFile(jsonPath);
      JSON.parse(raw);
    } catch (err) {
      violations.push({
        kind: 'invalid-json',
        file: jsonPath,
        message: `Invalid JSON: ${err.message}`,
      });
    }
  }

  return {
    checkedCount: modulesToCheck.length,
    violations,
  };
}

function gitExec(repoRoot, args, { allowNonZero = false } = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  try {
    return {
      status: 0,
      stdout: execFileSync('git', args, {
        cwd: repoRoot,
        env,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    };
  } catch (err) {
    if (allowNonZero) {
      return {
        status: typeof err.status === 'number' ? err.status : 1,
        stdout: err.stdout ? String(err.stdout) : '',
        stderr: err.stderr ? String(err.stderr) : '',
      };
    }
    throw err;
  }
}

export function validateWorkingTree(repoRoot, { onlyCheckFiles = null, tsLib } = {}) {
  const allTrackedFiles = gitExec(repoRoot, ['ls-files'])
    .stdout.split('\n')
    .filter((f) => f && fs.existsSync(path.join(repoRoot, f)));

  return validateModuleTree({
    allTrackedFiles,
    readFile: (f) => fs.readFileSync(path.join(repoRoot, f), 'utf8'),
    onlyCheckFiles,
    tsLib,
    resolveFromDir: repoRoot,
  });
}

/**
 * Simulates merging `headRef` into `baseRef` using read-only `git merge-tree --write-tree`
 * (zero working-tree mutations) and validates the merged files that differ from `baseRef`
 * or were touched by both sides (catching cross-PR duplicate imports/declarations/exports
 * even when branch protection has strict:false).
 */
export function validateSimulatedMerge(repoRoot, baseRef, headRef = 'HEAD', { tsLib } = {}) {

  const baseExists = gitExec(repoRoot, ['rev-parse', '--verify', '--quiet', baseRef], {
    allowNonZero: true,
  });
  if (baseExists.status !== 0) {
    return {
      skipped: true,
      reason: `base ref "${baseRef}" is not present locally`,
      checkedCount: 0,
      violations: [],
    };
  }

  const baseSha = baseExists.stdout.trim();
  const headSha = gitExec(repoRoot, ['rev-parse', '--verify', headRef]).stdout.trim();
  const mergeBase = gitExec(repoRoot, ['merge-base', baseSha, headSha], { allowNonZero: true });
  if (mergeBase.status !== 0) {
    return {
      skipped: true,
      reason: 'no common ancestor between base and head',
      checkedCount: 0,
      violations: [],
    };
  }
  const mergeBaseSha = mergeBase.stdout.trim();

  // If HEAD already includes all of baseRef, the working-tree/HEAD check already covers the exact merge result.
  if (mergeBaseSha === baseSha) {
    return {
      skipped: true,
      reason: 'HEAD is already up to date with base',
      checkedCount: 0,
      violations: [],
    };
  }

  const mergeRes = gitExec(repoRoot, ['merge-tree', '--write-tree', baseSha, headSha], {
    allowNonZero: true,
  });
  const firstLine = mergeRes.stdout.split('\n')[0]?.trim() || '';
  if (mergeRes.status !== 0 || !/^[0-9a-f]{40}$/.test(firstLine)) {
    const conflictDetails = mergeRes.stdout
      .split('\n')
      .filter((l) => /CONFLICT/.test(l))
      .slice(0, 10);
    return {
      skipped: false,
      checkedCount: 0,
      violations: [
        {
          kind: 'merge-conflict-against-base',
          file: baseRef,
          message:
            conflictDetails.length > 0
              ? `Merging ${headRef} into ${baseRef} produces conflicts: ${conflictDetails.join(' | ')}`
              : `git merge-tree against ${baseRef} failed (exit ${mergeRes.status}): ${mergeRes.stderr || mergeRes.stdout}`.trim(),
        },
      ],
    };
  }

  const mergedTreeSha = firstLine;
  const allMergedFiles = gitExec(repoRoot, ['ls-tree', '-r', '--name-only', mergedTreeSha])
    .stdout.split('\n')
    .filter(Boolean);

  // Check every file that differs between baseSha and mergedTreeSha (all branch edits + any dual-touched merges).
  const changedInMerge = gitExec(repoRoot, [
    'diff-tree',
    '-r',
    '--name-only',
    '--diff-filter=ACMR',
    baseSha,
    mergedTreeSha,
  ])
    .stdout.split('\n')
    .filter(Boolean);

  const blobCache = new Map();
  const readBlob = (filePath) => {
    if (blobCache.has(filePath)) return blobCache.get(filePath);
    const content = gitExec(repoRoot, ['cat-file', '-p', `${mergedTreeSha}:${filePath}`]).stdout;
    blobCache.set(filePath, content);
    return content;
  };

  const result = validateModuleTree({
    allTrackedFiles: allMergedFiles,
    readFile: readBlob,
    onlyCheckFiles: changedInMerge,
    tsLib,
    resolveFromDir: repoRoot,
  });

  return {
    skipped: false,
    mergedTreeSha,
    checkedCount: result.checkedCount,
    violations: result.violations.map((v) => ({
      ...v,
      message: `[simulated merge onto ${baseRef}] ${v.message}`,
    })),
  };
}

function parseCliArgs(argv) {
  const opts = {
    repoRoot: process.cwd(),
    mergeAgainst: null,
    changedSince: null,
    files: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--merge-against' && argv[i + 1]) {
      opts.mergeAgainst = argv[++i];
    } else if (arg === '--changed-since' && argv[i + 1]) {
      opts.changedSince = argv[++i];
    } else if (arg === '--repo' && argv[i + 1]) {
      opts.repoRoot = path.resolve(argv[++i]);
    } else if (arg === '--files') {
      opts.files.push(...argv.slice(i + 1));
      break;
    }
  }
  return opts;
}

function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const t0 = Date.now();

  let onlyCheckFiles = opts.files.length > 0 ? opts.files : null;
  if (!onlyCheckFiles && opts.changedSince) {
    const diffRes = gitExec(
      opts.repoRoot,
      ['diff', '--name-only', '--diff-filter=ACMR', opts.changedSince, 'HEAD'],
      { allowNonZero: true },
    );
    if (diffRes.status === 0) {
      onlyCheckFiles = diffRes.stdout.split('\n').filter(Boolean);
    }
  }

  const workingResult = validateWorkingTree(opts.repoRoot, { onlyCheckFiles });
  const allViolations = [...workingResult.violations];

  let mergeSummary = '';
  if (opts.mergeAgainst) {
    const mergeResult = validateSimulatedMerge(opts.repoRoot, opts.mergeAgainst, 'HEAD');
    if (!mergeResult.skipped) {
      allViolations.push(...mergeResult.violations);
      mergeSummary = `; simulated merge onto ${opts.mergeAgainst}: ${mergeResult.checkedCount} file(s)`;
    } else {
      mergeSummary = `; merge-tree skipped (${mergeResult.reason})`;
    }
  }

  const elapsedMs = Date.now() - t0;
  if (allViolations.length > 0) {
    console.error(
      `[check-module-parse-and-bindings] FAILED: ${allViolations.length} violation(s) found (${workingResult.checkedCount} checked${mergeSummary}, ${elapsedMs}ms):`,
    );
    for (const v of allViolations) {
      console.error(`  - [${v.kind}] ${v.file}: ${v.message}`);
    }
    process.exit(1);
  }

  console.log(
    `[check-module-parse-and-bindings] OK: ${workingResult.checkedCount} module(s) parsed & verified${mergeSummary} (${elapsedMs}ms).`,
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
