import { useState, type FormEvent } from "react";
import { LockKeyhole, LoaderCircle } from "lucide-react";
import { useTranslation } from "../../i18n.tsx";
import { login } from "../../services/authApi.ts";

interface LoginPageProps {
  onAuthenticated: () => void;
}

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await login(password);
      onAuthenticated();
    } catch {
      setError(t("auth.incorrectPassword"));
      setPassword("");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <span className="login-card__icon" aria-hidden="true">
          <LockKeyhole size={25} />
        </span>
        <p className="eyebrow">Cortex</p>
        <h1 id="login-title">{t("auth.title")}</h1>
        <p className="login-card__description">{t("auth.description")}</p>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label className="editor-field">
            <span>{t("auth.password")}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              required
              disabled={isSubmitting}
            />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" disabled={isSubmitting || !password}>
            {isSubmitting && <LoaderCircle className="spin" size={17} />}
            {isSubmitting ? t("auth.connecting") : t("auth.login")}
          </button>
        </form>
      </section>
    </main>
  );
}
