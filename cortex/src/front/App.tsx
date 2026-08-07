import { ProjectDirectoryManager } from "./page/project_manager/components/ProjectDirectoryManager.tsx";

export function App() {
  return (
    <main>
      <ProjectDirectoryManager />
      <section className="workspace-content">
        <p className="eyebrow">Cortex workspace</p>
        <h1>Cortex.</h1>
        <p className="intro">
          Ajoutez et retrouvez vos projets depuis le bandeau lateral.
        </p>
      </section>
    </main>
  );
}
