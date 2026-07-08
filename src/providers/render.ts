import { httpJson } from "./http.js";

/**
 * Render REST adapter. Base: https://api.render.com/v1 — auth: Bearer RENDER_API_KEY.
 * Render returns cursor-wrapped list items for services/deploys; this adapter
 * normalizes those envelopes to stable shapes for provider-actions.
 */
const BASE = "https://api.render.com/v1";

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

function jsonHeaders(token: string): Record<string, string> {
  return { ...headers(token), "Content-Type": "application/json" };
}

function csv(values?: string | string[]): string | undefined {
  if (Array.isArray(values)) return values.length > 0 ? values.join(",") : undefined;
  return values;
}

export interface RenderService {
  id: string;
  name: string;
  ownerId: string;
  type: string;
  createdAt?: string;
  updatedAt?: string;
  dashboardUrl?: string;
  environmentId?: string;
  repo?: string;
  slug?: string;
  suspended?: string;
  url?: string;
  serviceDetails?: Record<string, unknown>;
}

function serviceFrom(raw: Record<string, any>): RenderService {
  return {
    id: raw.id,
    name: raw.name,
    ownerId: raw.ownerId,
    type: raw.type,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    dashboardUrl: raw.dashboardUrl,
    environmentId: raw.environmentId,
    repo: raw.repo,
    slug: raw.slug,
    suspended: raw.suspended,
    url: raw.serviceDetails?.url,
    serviceDetails: raw.serviceDetails,
  };
}

export async function listServices(
  token: string,
  opts: {
    ownerId?: string;
    environmentId?: string;
    name?: string | string[];
    type?: string | string[];
    limit?: number;
    cursor?: string;
  } = {},
): Promise<RenderService[]> {
  const data = await httpJson<any[]>(`${BASE}/services`, {
    headers: headers(token),
    query: {
      ownerId: csv(opts.ownerId),
      environmentId: csv(opts.environmentId),
      name: csv(opts.name),
      type: csv(opts.type),
      limit: opts.limit !== undefined ? String(opts.limit) : undefined,
      cursor: opts.cursor,
    },
  });
  return (data ?? []).map((item) => serviceFrom(item.service ?? item));
}

export async function getService(token: string, serviceId: string): Promise<RenderService> {
  const data = await httpJson<Record<string, any>>(`${BASE}/services/${serviceId}`, {
    headers: headers(token),
  });
  return serviceFrom(data);
}

export interface RenderDeploy {
  id: string;
  status?: string;
  trigger?: string;
  commit?: { id?: string; message?: string; createdAt?: string };
  image?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

function deployFrom(raw: Record<string, any>): RenderDeploy {
  return {
    id: raw.id,
    status: raw.status,
    trigger: raw.trigger,
    commit: raw.commit,
    image: raw.image,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    startedAt: raw.startedAt,
    finishedAt: raw.finishedAt,
  };
}

export async function listDeploys(
  token: string,
  serviceId: string,
  limit = 10,
): Promise<RenderDeploy[]> {
  const data = await httpJson<any[]>(`${BASE}/services/${serviceId}/deploys`, {
    headers: headers(token),
    query: { limit: String(limit) },
  });
  return (data ?? []).map((item) => deployFrom(item.deploy ?? item));
}

export async function getDeploy(
  token: string,
  serviceId: string,
  deployId: string,
): Promise<RenderDeploy> {
  const data = await httpJson<Record<string, any>>(`${BASE}/services/${serviceId}/deploys/${deployId}`, {
    headers: headers(token),
  });
  return deployFrom(data);
}

export interface RenderLog {
  timestamp?: string;
  message?: string;
  level?: string;
  type?: string;
}

export interface RenderLogsResult {
  logs: RenderLog[];
  hasMore?: boolean;
  nextStartTime?: string;
  nextEndTime?: string;
}

export async function getServiceLogs(
  token: string,
  serviceId: string,
  opts: { ownerId?: string; startTime?: string; endTime?: string; limit?: number } = {},
): Promise<RenderLogsResult> {
  const ownerId = opts.ownerId ?? (await getService(token, serviceId)).ownerId;
  const data = await httpJson<Record<string, any>>(`${BASE}/logs`, {
    headers: headers(token),
    query: {
      ownerId,
      resource: serviceId,
      startTime: opts.startTime,
      endTime: opts.endTime,
      direction: "backward",
      limit: opts.limit !== undefined ? String(opts.limit) : undefined,
    },
  });
  const rawLogs = Array.isArray(data)
    ? data
    : Array.isArray(data.logs)
      ? data.logs
      : Array.isArray(data.results)
        ? data.results
        : [];
  return {
    logs: rawLogs.map((l: Record<string, any>) => ({
      timestamp: l.timestamp ?? l.time ?? l.createdAt,
      message: l.message ?? l.text ?? l.log,
      level: l.level ?? l.severity,
      type: l.type,
    })),
    hasMore: typeof data.hasMore === "boolean" ? data.hasMore : undefined,
    nextStartTime: data.nextStartTime,
    nextEndTime: data.nextEndTime,
  };
}

export async function triggerDeploy(
  token: string,
  serviceId: string,
  params: {
    clearCache?: boolean;
    commitId?: string;
    imageUrl?: string;
    deployMode?: "deploy_only" | "build_and_deploy";
  } = {},
): Promise<RenderDeploy | Record<string, unknown>> {
  const body: Record<string, unknown> = {};
  if (params.clearCache !== undefined) body.clearCache = params.clearCache ? "clear" : "do_not_clear";
  if (params.commitId) body.commitId = params.commitId;
  if (params.imageUrl) body.imageUrl = params.imageUrl;
  if (params.deployMode) body.deployMode = params.deployMode;
  const data = await httpJson<Record<string, any>>(`${BASE}/services/${serviceId}/deploys`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify(body),
  });
  return data?.id ? deployFrom(data) : data;
}

export async function setEnvVar(
  token: string,
  serviceId: string,
  key: string,
  value: string,
): Promise<Record<string, unknown>> {
  return httpJson<Record<string, unknown>>(
    `${BASE}/services/${serviceId}/env-vars/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ value }),
    },
  );
}

export async function setEnvVars(
  token: string,
  serviceId: string,
  values: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const entries = Object.entries(values);
  const results: Record<string, unknown>[] = [];
  for (const [key, value] of entries) {
    results.push(await setEnvVar(token, serviceId, key, value));
  }
  return results;
}
