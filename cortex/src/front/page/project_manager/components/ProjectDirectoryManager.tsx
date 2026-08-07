import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  saveProjectDirectory,
  selectProjectDirectory
} from "../../../services/projectApi.ts";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Une erreur inattendue est survenue.";
}

export function ProjectDirectoryManager() {
  const directoryDialog = useRef<HTMLDialogElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [directoryPath, setDirectoryPath] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [error, setError] = useState("");
  const [isSelecting, setIsSelecting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isModalOpen && !directoryDialog.current?.open) {
      directoryDialog.current?.showModal();
    }
  }, [isModalOpen]);

  async function handleDirectorySelection(): Promise<void> {
    setIsSelecting(true);
    setError("");
    setSaveMessage("");

    try {
      const selectedDirectoryPath = await selectProjectDirectory();

      if (selectedDirectoryPath) {
        setDirectoryPath(selectedDirectoryPath);
        setIsModalOpen(true);
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSelecting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    setSaveMessage("");

    try {
      await saveProjectDirectory(directoryPath);
      setSaveMessage("Le repertoire du projet a ete enregistre.");
      setIsModalOpen(false);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  function closeModal(): void {
    setError("");
    setIsModalOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleDirectorySelection}
        disabled={isSelecting}
      >
        {isSelecting ? "Ouverture du selecteur..." : "Selectionner un repertoire"}
      </button>
      {saveMessage && <p className="response">{saveMessage}</p>}
      {error && !isModalOpen && <p className="error" role="alert">{error}</p>}

      {isModalOpen && (
        <dialog
          ref={directoryDialog}
          aria-labelledby="directory-dialog-title"
          onClose={closeModal}
        >
          <form onSubmit={handleSubmit}>
            <h2 id="directory-dialog-title">Repertoire du projet</h2>
            <p>Verifiez le repertoire selectionne avant de l'enregistrer.</p>
            <label htmlFor="directory-path">Chemin du repertoire</label>
            <input
              id="directory-path"
              type="text"
              value={directoryPath}
              readOnly
              required
            />
            {error && <p className="error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={closeModal}
              >
                Annuler
              </button>
              <button type="submit" disabled={isSaving}>
                {isSaving ? "Enregistrement..." : "Enregistrer"}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
