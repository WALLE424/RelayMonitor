'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseProviderConfig } = require('./provider-config');

const PYTHON_QUERY = String.raw`
import json
import pathlib
import sqlite3
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

db_path = sys.argv[1]
options = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
provider_limit = int(options.get("providerLimit", 100))
recent_limit = int(options.get("recentLimit", 25))
rollup_limit = int(options.get("rollupLimit", 1200))
request_daily_limit = int(options.get("requestDailyLimit", 1200))

def literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"

def table_exists(con, table):
    row = con.execute("select 1 from sqlite_master where type='table' and name=?", (table,)).fetchone()
    return row is not None

def table_columns(con, table):
    if not table_exists(con, table):
        return set()
    return {row[1] for row in con.execute("pragma table_info(" + table + ")").fetchall()}

def select_exprs(columns, specs):
    exprs = []
    for column_spec, alias, default in specs:
        if isinstance(column_spec, (list, tuple)):
            candidates = column_spec
        else:
            candidates = [column_spec]
        column = next((item for item in candidates if item in columns), None)
        if column:
            exprs.append('"' + column + '" as "' + alias + '"')
        else:
            exprs.append(literal(default) + ' as "' + alias + '"')
    return ", ".join(exprs)

def order_by_clause(columns, specs):
    parts = []
    for column_spec, direction in specs:
        if isinstance(column_spec, (list, tuple)):
            candidates = column_spec
        else:
            candidates = [column_spec]
        column = next((item for item in candidates if item in columns), None)
        if column:
            parts.append('"' + column + '" ' + direction)
    return "order by " + ", ".join(parts) if parts else ""

def fetch_rows(con, table, specs, order_by="", limit=100, where_clause="", params=()):
    columns = table_columns(con, table)
    if not columns:
        return []
    sql = "select " + select_exprs(columns, specs) + " from " + table
    if where_clause:
        sql += " where " + where_clause
    if isinstance(order_by, list):
        order_by = order_by_clause(columns, order_by)
    if order_by:
        sql += " " + order_by
    sql += " limit ?"
    return [dict(row) for row in con.execute(sql, tuple(params) + (limit,)).fetchall()]

def first_column(columns, candidates):
    for column in candidates:
        if column in columns:
            return column
    return None

def quoted(column):
    return '"' + column + '"'

def number_expr(column):
    return "coalesce(cast(" + quoted(column) + " as real), 0)" if column else "0"

def date_expr(column):
    if not column:
        return "''"
    value = number_expr(column)
    return "date(case when " + value + " > 1000000000000 then " + value + " / 1000 else " + value + " end, 'unixepoch', 'localtime')"

def cost_expr(columns):
    total_col = first_column(columns, ("total_cost_usd", "totalCostUsd", "cost_usd", "costUsd", "cost"))
    component_cols = [
        first_column(columns, ("input_cost_usd", "inputCostUsd", "prompt_cost_usd", "promptCostUsd")),
        first_column(columns, ("output_cost_usd", "outputCostUsd", "completion_cost_usd", "completionCostUsd")),
        first_column(columns, ("cache_read_cost_usd", "cacheReadCostUsd")),
        first_column(columns, ("cache_creation_cost_usd", "cacheCreationCostUsd", "cache_write_cost_usd", "cacheWriteCostUsd")),
    ]
    component_sql = " + ".join(number_expr(column) for column in component_cols if column)
    if not component_sql:
        component_sql = "0"
    if not total_col:
        return component_sql
    total_sql = number_expr(total_col)
    return "case when " + total_sql + " != 0 then " + total_sql + " else " + component_sql + " end"

def current_provider_row(rows):
    current = [row for row in rows if str(row.get("is_current", "0")) not in ("", "0", "False", "false")]
    with_url = [row for row in current if str(row.get("settings_config", "")) or str(row.get("website_url", ""))]
    if with_url:
        return with_url[0]
    if current:
        return current[0]
    return rows[0] if rows else {}

def filtered_where(columns, provider):
    parts = []
    params = []
    app_col = first_column(columns, ("app_type", "appType", "app"))
    provider_col = first_column(columns, ("provider_id", "providerId", "id"))
    app_type = str(provider.get("app_type", "")).strip()
    provider_id = str(provider.get("id", "") or provider.get("provider_id", "")).strip()
    if app_col and app_type:
        parts.append(quoted(app_col) + " = ?")
        params.append(app_type)
    if provider_col and provider_id:
        parts.append(quoted(provider_col) + " = ?")
        params.append(provider_id)
    return (" and ".join(parts), params)

def app_only_where(columns, provider):
    app_col = first_column(columns, ("app_type", "appType", "app"))
    app_type = str(provider.get("app_type", "")).strip()
    if app_col and app_type:
        return quoted(app_col) + " = ?", [app_type]
    return "", []

def fetch_filtered_rows(con, table, specs, order_by, limit, provider):
    columns = table_columns(con, table)
    where_clause, params = filtered_where(columns, provider)
    rows = fetch_rows(con, table, specs, order_by, limit, where_clause, params)
    if rows or not where_clause:
        return rows
    app_where, app_params = app_only_where(columns, provider)
    rows = fetch_rows(con, table, specs, order_by, limit, app_where, app_params)
    if rows or not app_where:
        return rows
    return fetch_rows(con, table, specs, order_by, limit)

def fetch_request_daily_rollups(con, provider, limit=366, strict_provider=True):
    columns = table_columns(con, "proxy_request_logs")
    if not columns:
        return []

    created_col = first_column(columns, ("created_at", "createdAt", "timestamp", "time"))
    if not created_col:
        return []

    date_sql = date_expr(created_col)
    app_col = first_column(columns, ("app_type", "appType", "app"))
    provider_col = first_column(columns, ("provider_id", "providerId"))
    model_col = first_column(columns, ("request_model", "requestModel", "model_name", "modelName", "model", "provider_model", "providerModel"))
    status_col = first_column(columns, ("status_code", "statusCode"))
    input_col = first_column(columns, ("input_tokens", "inputTokens", "prompt_tokens", "promptTokens"))
    output_col = first_column(columns, ("output_tokens", "outputTokens", "completion_tokens", "completionTokens"))
    cache_read_col = first_column(columns, ("cache_read_tokens", "cacheReadTokens", "cache_read_input_tokens", "cacheReadInputTokens"))
    cache_creation_col = first_column(columns, ("cache_creation_tokens", "cacheCreationTokens", "cache_creation_input_tokens", "cacheCreationInputTokens"))
    request_cost_sql = cost_expr(columns)
    latency_col = first_column(columns, ("latency_ms", "latencyMs", "elapsed_ms", "elapsedMs"))

    success_expr = (
        "sum(case when " + number_expr(status_col) + " >= 200 and " + number_expr(status_col) + " < 400 then 1 else 0 end)"
        if status_col else "count(*)"
    )
    where_parts = [date_sql + " is not null", date_sql + " != ''"]
    where_filter, where_params = filtered_where(columns, provider) if strict_provider else app_only_where(columns, provider)
    if where_filter:
        where_parts.append(where_filter)

    sql = """
select
  """ + date_sql + """ as "date",
  """ + (quoted(app_col) if app_col else "''") + """ as "app_type",
  """ + (quoted(provider_col) if provider_col else "''") + """ as "provider_id",
  """ + (("min(" + quoted(model_col) + ")") if model_col else "''") + """ as "model",
  count(*) as "request_count",
  """ + success_expr + """ as "success_count",
  sum(""" + number_expr(input_col) + """) as "input_tokens",
  sum(""" + number_expr(output_col) + """) as "output_tokens",
  sum(""" + number_expr(cache_read_col) + """) as "cache_read_tokens",
  sum(""" + number_expr(cache_creation_col) + """) as "cache_creation_tokens",
  sum(""" + request_cost_sql + """) as "total_cost_usd",
  round(avg(nullif(""" + number_expr(latency_col) + """, 0))) as "avg_latency_ms"
from proxy_request_logs
where """ + " and ".join(where_parts) + """
group by """ + date_sql + ((", " + quoted(app_col)) if app_col else "") + ((", " + quoted(provider_col)) if provider_col else "") + """
order by "date" desc
limit ?
"""
    rows = [dict(row) for row in con.execute(sql, tuple(where_params) + (limit,)).fetchall()]
    if rows or not strict_provider or not where_filter:
        return rows
    rows = fetch_request_daily_rollups(con, provider, limit, strict_provider=False)
    if rows:
        return rows
    return fetch_request_daily_rollups(con, {}, limit, strict_provider=False)

uri = pathlib.Path(db_path).resolve().as_uri() + "?mode=ro"
con = sqlite3.connect(uri, uri=True)
con.row_factory = sqlite3.Row

provider_specs = [
    (("id", "provider_id", "providerId"), "id", ""),
    (("app_type", "appType", "app"), "app_type", ""),
    (("name", "display_name", "label"), "name", ""),
    (("settings_config", "settingsConfig", "settings", "config"), "settings_config", "{}"),
    (("website_url", "websiteUrl"), "website_url", ""),
    ("category", "category", ""),
    ("meta", "meta", "{}"),
    (("is_current", "isCurrent", "current"), "is_current", 0),
    (("sort_index", "sortIndex", "priority"), "sort_index", 0),
    (("provider_type", "providerType", "type"), "provider_type", ""),
    (("cost_multiplier", "costMultiplier"), "cost_multiplier", "1"),
]

provider_order = [
    (("is_current", "isCurrent", "current"), "desc"),
    (("app_type", "appType", "app"), "asc"),
    (("sort_index", "sortIndex", "priority"), "asc"),
    (("name", "display_name", "label"), "asc"),
]

providers = fetch_rows(con, "providers", provider_specs, provider_order, provider_limit)
if not providers:
    providers = fetch_rows(con, "provider_configs", provider_specs, provider_order, provider_limit)
current_provider = current_provider_row(providers)

proxy_config = fetch_rows(con, "proxy_config", [
    (("app_type", "appType", "app"), "app_type", ""),
    (("proxy_enabled", "proxyEnabled"), "proxy_enabled", 0),
    (("listen_address", "listenAddress", "host"), "listen_address", "127.0.0.1"),
    (("listen_port", "listenPort", "port"), "listen_port", 15721),
    (("enable_logging", "enableLogging"), "enable_logging", 1),
    ("enabled", "enabled", 0),
    (("auto_failover_enabled", "autoFailoverEnabled"), "auto_failover_enabled", 0),
    (("live_takeover_active", "liveTakeoverActive"), "live_takeover_active", 0),
], [
    (("app_type", "appType", "app"), "asc"),
], 10)

recent_requests = fetch_filtered_rows(con, "proxy_request_logs", [
    (("request_id", "requestId", "id"), "request_id", ""),
    (("provider_id", "providerId"), "provider_id", ""),
    (("app_type", "appType", "app"), "app_type", ""),
    (("model", "provider_model", "providerModel"), "model", ""),
    (("request_model", "requestModel", "model_name", "modelName"), "request_model", ""),
    (("reasoning_effort", "reasoningEffort"), "reasoning_effort", ""),
    (("request_reasoning_effort", "requestReasoningEffort"), "request_reasoning_effort", ""),
    (("model_reasoning_effort", "modelReasoningEffort"), "model_reasoning_effort", ""),
    (("input_tokens", "inputTokens", "prompt_tokens", "promptTokens"), "input_tokens", 0),
    (("output_tokens", "outputTokens", "completion_tokens", "completionTokens"), "output_tokens", 0),
    (("cache_read_tokens", "cacheReadTokens", "cache_read_input_tokens", "cacheReadInputTokens"), "cache_read_tokens", 0),
    (("cache_creation_tokens", "cacheCreationTokens", "cache_creation_input_tokens", "cacheCreationInputTokens"), "cache_creation_tokens", 0),
    (("total_cost_usd", "totalCostUsd", "cost_usd", "costUsd"), "total_cost_usd", "0"),
    (("latency_ms", "latencyMs", "elapsed_ms", "elapsedMs"), "latency_ms", 0),
    (("first_token_ms", "firstTokenMs"), "first_token_ms", None),
    (("duration_ms", "durationMs"), "duration_ms", None),
    (("status_code", "statusCode"), "status_code", 0),
    (("session_id", "sessionId", "conversation_id", "conversationId"), "session_id", ""),
    (("provider_type", "providerType"), "provider_type", ""),
    (("is_streaming", "isStreaming"), "is_streaming", 0),
    (("created_at", "createdAt", "timestamp", "time"), "created_at", 0),
    (("data_source", "dataSource"), "data_source", "proxy"),
], [
    (("created_at", "createdAt", "timestamp", "time"), "desc"),
], recent_limit, current_provider)

usage_daily_rollups = fetch_filtered_rows(con, "usage_daily_rollups", [
    ("date", "date", ""),
    (("app_type", "appType", "app"), "app_type", ""),
    (("provider_id", "providerId"), "provider_id", ""),
    (("model", "model_name", "modelName"), "model", ""),
    (("request_count", "requestCount"), "request_count", 0),
    (("success_count", "successCount"), "success_count", 0),
    (("input_tokens", "inputTokens", "prompt_tokens", "promptTokens"), "input_tokens", 0),
    (("output_tokens", "outputTokens", "completion_tokens", "completionTokens"), "output_tokens", 0),
    (("cache_read_tokens", "cacheReadTokens", "cache_read_input_tokens", "cacheReadInputTokens"), "cache_read_tokens", 0),
    (("cache_creation_tokens", "cacheCreationTokens", "cache_creation_input_tokens", "cacheCreationInputTokens"), "cache_creation_tokens", 0),
    (("total_cost_usd", "totalCostUsd", "cost_usd", "costUsd"), "total_cost_usd", "0"),
    (("avg_latency_ms", "avgLatencyMs"), "avg_latency_ms", 0),
], [
    ("date", "desc"),
], rollup_limit, current_provider)

request_daily_rollups = fetch_request_daily_rollups(con, current_provider, request_daily_limit)

print(json.dumps({
    "providers": providers,
    "proxyConfig": proxy_config,
    "recentRequests": recent_requests,
    "usageDailyRollups": usage_daily_rollups,
    "requestDailyRollups": request_daily_rollups,
}, ensure_ascii=False))
`;

function defaultDbPath() {
  return path.join(os.homedir(), '.cc-switch', 'cc-switch.db');
}

function emptyState(status, dbPath, error) {
  const state = {
    status,
    dbPath,
    checkedAt: new Date().toISOString(),
    providers: [],
    proxyConfig: [],
    recentRequests: [],
    usageDailyRollups: [],
  };
  if (error) state.error = error;
  return state;
}

function execPython(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toOptionalNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toBoolean(value) {
  return Boolean(Number(value));
}

function mapRequest(row) {
  const providerModel = String(row.model || '');
  const requestModel = String(row.request_model || '');
  const requestReasoningEffort = String(row.request_reasoning_effort || row.reasoning_effort || row.model_reasoning_effort || '');
  return {
    requestId: String(row.request_id || ''),
    providerId: String(row.provider_id || ''),
    appType: String(row.app_type || ''),
    model: requestModel || providerModel,
    providerModel,
    requestModel,
    reasoningEffort: requestReasoningEffort,
    requestReasoningEffort,
    inputTokens: toNumber(row.input_tokens),
    outputTokens: toNumber(row.output_tokens),
    cacheReadTokens: toNumber(row.cache_read_tokens),
    cacheCreationTokens: toNumber(row.cache_creation_tokens),
    totalCostUsd: toNumber(row.total_cost_usd),
    latencyMs: toNumber(row.latency_ms),
    firstTokenMs: toOptionalNumber(row.first_token_ms),
    durationMs: toOptionalNumber(row.duration_ms),
    statusCode: toNumber(row.status_code),
    sessionId: String(row.session_id || ''),
    providerType: String(row.provider_type || ''),
    isStreaming: toBoolean(row.is_streaming),
    createdAt: toNumber(row.created_at),
    dataSource: String(row.data_source || 'proxy'),
  };
}

function mapRollup(row) {
  return {
    date: String(row.date || ''),
    appType: String(row.app_type || ''),
    providerId: String(row.provider_id || ''),
    model: String(row.model || ''),
    requestCount: toNumber(row.request_count),
    successCount: toNumber(row.success_count),
    inputTokens: toNumber(row.input_tokens),
    outputTokens: toNumber(row.output_tokens),
    cacheReadTokens: toNumber(row.cache_read_tokens),
    cacheCreationTokens: toNumber(row.cache_creation_tokens),
    totalCostUsd: toNumber(row.total_cost_usd),
    avgLatencyMs: toNumber(row.avg_latency_ms),
  };
}

function mapProxyConfig(row) {
  return {
    appType: String(row.app_type || ''),
    proxyEnabled: toBoolean(row.proxy_enabled),
    listenAddress: String(row.listen_address || '127.0.0.1'),
    listenPort: toNumber(row.listen_port) || 15721,
    enableLogging: toBoolean(row.enable_logging),
    enabled: toBoolean(row.enabled),
    autoFailoverEnabled: toBoolean(row.auto_failover_enabled),
    liveTakeoverActive: toBoolean(row.live_takeover_active),
  };
}

function parsePythonResult(stdout, dbPath) {
  const parsed = JSON.parse(stdout || '{}');
  return {
    status: 'ok',
    dbPath,
    checkedAt: new Date().toISOString(),
    providers: (parsed.providers || []).map(parseProviderConfig),
    proxyConfig: (parsed.proxyConfig || []).map(mapProxyConfig),
    recentRequests: (parsed.recentRequests || []).map(mapRequest),
    usageDailyRollups: (parsed.usageDailyRollups || []).map(mapRollup),
    requestDailyRollups: (parsed.requestDailyRollups || []).map(mapRollup),
  };
}

async function readRelayState(options = {}) {
  const dbPath = options.dbPath || defaultDbPath();
  if (!fs.existsSync(dbPath)) {
    return emptyState('missing', dbPath, { message: 'cc-switch.db was not found' });
  }

  const pythonCommand = options.pythonCommand || 'python';
    const queryOptions = {
    providerLimit: options.providerLimit ?? 100,
    recentLimit: options.recentLimit ?? 25,
    rollupLimit: options.rollupLimit ?? 1200,
    requestDailyLimit: options.requestDailyLimit ?? 1200,
  };

  try {
    const stdout = await execPython(
      pythonCommand,
      ['-c', PYTHON_QUERY, dbPath, JSON.stringify(queryOptions)],
      {
        encoding: 'utf8',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        maxBuffer: options.maxBuffer || 1024 * 1024 * 4,
        timeout: options.timeoutMs || 8000,
        windowsHide: true,
      },
    );
    return parsePythonResult(stdout, dbPath);
  } catch (error) {
    return emptyState('error', dbPath, {
      message: error.message || 'Unable to query cc-switch.db',
      code: error.code || '',
      stderr: error.stderr || '',
    });
  }
}

module.exports = {
  defaultDbPath,
  readRelayState,
};
