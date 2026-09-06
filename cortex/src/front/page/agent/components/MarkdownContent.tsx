import { lazy, Suspense } from "react";
import { useTranslation } from "../../../i18n.tsx";

const MarkdownRenderer = lazy(() => import("./MarkdownRenderer.tsx")
  .then((module) => ({ default: module.MarkdownRenderer })));

export function MarkdownContent(props: { content: string; className?: string }) {
  const { t } = useTranslation();
  return <Suspense fallback={<span role="status">{t("common.loading")}</span>}>
    <MarkdownRenderer {...props} />
  </Suspense>;
}
