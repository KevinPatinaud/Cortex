import {
  Check,
  Download,
  PlugZap,
  RefreshCw,
  Trash2,
  TriangleAlert
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../../i18n.tsx";
import {
  getCodexPlugins,
  installCodexPlugin,
  removeCodexPlugin,
  type CodexPluginCatalog,
  type CodexPluginSummary
} from "../../../services/agentApi.ts";

const EMPTY_CATALOG: CodexPluginCatalog = {
  available: true,
  plugins: [],
  error: null
};

const FEATURED_PLUGIN_IDS = [
  "atlassian-rovo@openai-curated",
  "google-calendar@openai-curated",
  "gmail@openai-curated",
  "github@openai-curated"
];

const PLUGIN_LABELS: Record<string, string> = {
  "atlassian-rovo": "Jira / Confluence",
  "google-calendar": "Google Calendar",
  gmail: "Gmail",
  github: "GitHub"
};

export function CodexPluginPanel({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState(EMPTY_CATALOG);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingPluginId, setPendingPluginId] = useState("");
  const [selectedPluginId, setSelectedPluginId] = useState("");
  const [error, setError] = useState("");

  const connectorPlugins = useMemo(() => catalog.plugins.filter((plugin) =>
    plugin.marketplace.includes("curated")
  ), [catalog.plugins]);
  const featuredPlugins = FEATURED_PLUGIN_IDS.flatMap((pluginId) => {
    const plugin = connectorPlugins.find((candidate) => candidate.id === pluginId);
    return plugin ? [plugin] : [];
  });
  const installedOtherPlugins = connectorPlugins.filter((plugin) =>
    plugin.installed && !FEATURED_PLUGIN_IDS.includes(plugin.id)
  );
  const otherAvailablePlugins = connectorPlugins.filter((plugin) =>
    !plugin.installed && !FEATURED_PLUGIN_IDS.includes(plugin.id)
  );
  const visiblePlugins = [...featuredPlugins, ...installedOtherPlugins];
  const installedCount = connectorPlugins.filter((plugin) => plugin.installed).length;

  useEffect(() => {
    let isMounted = true;

    void getCodexPlugins()
      .then((nextCatalog) => {
        if (isMounted) setCatalog(nextCatalog);
      })
      .catch((loadError: unknown) => {
        if (isMounted) {
          setCatalog({
            available: false,
            plugins: [],
            error: loadError instanceof Error
              ? loadError.message
              : t("plugins.loadError")
          });
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  async function refresh(): Promise<void> {
    setIsLoading(true);
    setError("");

    try {
      setCatalog(await getCodexPlugins());
    } catch (refreshError) {
      setError(refreshError instanceof Error
        ? refreshError.message
        : t("plugins.loadError"));
    } finally {
      setIsLoading(false);
    }
  }

  async function install(pluginId: string): Promise<void> {
    setPendingPluginId(pluginId);
    setError("");

    try {
      setCatalog(await installCodexPlugin(pluginId));
      setSelectedPluginId("");
      onChanged();
    } catch (installError) {
      setError(installError instanceof Error
        ? installError.message
        : t("plugins.installError"));
    } finally {
      setPendingPluginId("");
    }
  }

  async function remove(plugin: CodexPluginSummary): Promise<void> {
    if (!window.confirm(t("plugins.removeConfirm", {
      name: getPluginLabel(plugin)
    }))) {
      return;
    }

    setPendingPluginId(plugin.id);
    setError("");

    try {
      setCatalog(await removeCodexPlugin(plugin.id));
      onChanged();
    } catch (removeError) {
      setError(removeError instanceof Error
        ? removeError.message
        : t("plugins.removeError"));
    } finally {
      setPendingPluginId("");
    }
  }

  return (
    <section className="agent-engine-plugins" aria-labelledby="codex-plugins-title">
      <header>
        <span>
          <PlugZap aria-hidden="true" size={15} strokeWidth={1.8} />
          <span>
            <strong id="codex-plugins-title">{t("plugins.title")}</strong>
            <small>{t("plugins.count", { count: installedCount })}</small>
          </span>
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={isLoading || Boolean(pendingPluginId)}
          title={t("plugins.refresh")}
          aria-label={t("plugins.refresh")}
        >
          <RefreshCw
            className={isLoading ? "spin" : undefined}
            aria-hidden="true"
            size={14}
          />
        </button>
      </header>
      <p className="agent-engine-plugins__help">{t("plugins.help")}</p>
      {(catalog.error || error) && (
        <p className="agent-engine-plugins__error" role="alert">
          <TriangleAlert aria-hidden="true" size={13} />
          <span>{error || catalog.error}</span>
        </p>
      )}
      {catalog.available && (
        <>
          <ul className="agent-engine-plugins__list">
            {visiblePlugins.map((plugin) => (
              <li key={plugin.id}>
                <span className="agent-engine-plugins__plugin">
                  <strong>{getPluginLabel(plugin)}</strong>
                  <small>
                    {plugin.version ? `v${plugin.version} · ` : ""}
                    {plugin.installed
                      ? t("plugins.installed")
                      : t("plugins.available")}
                  </small>
                </span>
                {plugin.installed ? (
                  <span className="agent-engine-plugins__installed">
                    <Check aria-hidden="true" size={12} />
                    <button
                      type="button"
                      onClick={() => void remove(plugin)}
                      disabled={Boolean(pendingPluginId)}
                      title={t("plugins.remove")}
                      aria-label={`${t("plugins.remove")} ${getPluginLabel(plugin)}`}
                    >
                      <Trash2 aria-hidden="true" size={13} />
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="agent-engine-plugins__install"
                    onClick={() => void install(plugin.id)}
                    disabled={Boolean(pendingPluginId)}
                  >
                    <Download aria-hidden="true" size={12} />
                    {pendingPluginId === plugin.id
                      ? t("plugins.installing")
                      : t("plugins.install")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {otherAvailablePlugins.length > 0 && (
            <form
              className="agent-engine-plugins__other"
              onSubmit={(event) => {
                event.preventDefault();
                if (selectedPluginId) void install(selectedPluginId);
              }}
            >
              <select
                value={selectedPluginId}
                onChange={(event) => setSelectedPluginId(event.target.value)}
                disabled={Boolean(pendingPluginId)}
                aria-label={t("plugins.other")}
              >
                <option value="">{t("plugins.other")}</option>
                {otherAvailablePlugins.map((plugin) => (
                  <option key={plugin.id} value={plugin.id}>
                    {getPluginLabel(plugin)}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!selectedPluginId || Boolean(pendingPluginId)}
              >
                <Download aria-hidden="true" size={13} />
                {t("plugins.install")}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

function getPluginLabel(plugin: CodexPluginSummary): string {
  return PLUGIN_LABELS[plugin.name] ?? plugin.name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
