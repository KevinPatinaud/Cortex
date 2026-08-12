import { defineTool } from "@github/copilot-sdk";
import { spawn } from "node:child_process";

interface GitHubPullRequestToolInput {
  owner: string;
  repository: string;
}

interface GitHubPullRequestFilesToolInput extends GitHubPullRequestToolInput {
  pullRequestNumber: number;
}

interface GitHubPullRequestResponse {
  number: number;
  title: string;
  user: { login: string } | null;
  labels: Array<{ name: string; color: string }>;
}

interface GitHubCommitResponse {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
  author: { login: string } | null;
}

interface GitHubCommentResponse {
  id: number;
  body: string;
  created_at: string;
  user: { login: string } | null;
}

interface GitHubReviewCommentResponse extends GitHubCommentResponse {
  path: string;
  line: number | null;
}

interface GitHubReviewResponse {
  id: number;
  body: string;
  state: string;
  submitted_at: string | null;
  user: { login: string } | null;
}

interface GitHubPullRequestFileResponse {
  additions: number;
  blob_url: string;
  changes: number;
  deletions: number;
  filename: string;
  patch?: string;
  previous_filename?: string;
  status: string;
}

export interface GitHubPullRequest {
  author: string;
  comments: Array<{
    author: string;
    body: string;
    createdAt: string;
    id: number;
    kind: "conversation" | "review";
    line?: number;
    path?: string;
  }>;
  commits: Array<{
    author: string;
    date: string | null;
    message: string;
    sha: string;
  }>;
  labels: Array<{ color: string; name: string }>;
  number: number;
  reviews: Array<{
    author: string;
    body: string;
    id: number;
    state: string;
    submittedAt: string | null;
  }>;
  title: string;
}

export interface GitHubPullRequestFile {
  additions: number;
  blobUrl: string;
  changes: number;
  deletions: number;
  filename: string;
  patch: string | null;
  previousFilename: string | null;
  status: string;
}

export interface GitHubPullRequestsDependencies {
  fetch: typeof fetch;
  readCredential: () => Promise<string>;
}

const defaultDependencies: GitHubPullRequestsDependencies = {
  fetch,
  readCredential: readGitHubCredential
};

export function createGitHubPullRequestsTool(
  dependencies: GitHubPullRequestsDependencies = defaultDependencies
) {
  return defineTool<GitHubPullRequestToolInput>(
    "list_github_pull_requests",
    {
      description: "List open pull requests with labels, commit history, comments and review decisions from a GitHub repository.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["owner", "repository"],
        properties: {
          owner: { type: "string", minLength: 1 },
          repository: { type: "string", minLength: 1 }
        }
      },
      defer: "auto",
      skipPermission: true,
      handler: ({ owner, repository }) => listOpenPullRequests(
        owner,
        repository,
        dependencies
      )
    }
  );
}

export function createGitHubPullRequestFilesTool(
  dependencies: GitHubPullRequestsDependencies = defaultDependencies
) {
  return defineTool<GitHubPullRequestFilesToolInput>(
    "get_github_pull_request_files",
    {
      description: "Get changed files and patches for a GitHub pull request, including private repositories.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["owner", "repository", "pullRequestNumber"],
        properties: {
          owner: { type: "string", minLength: 1 },
          repository: { type: "string", minLength: 1 },
          pullRequestNumber: { type: "integer", minimum: 1 }
        }
      },
      defer: "auto",
      skipPermission: true,
      handler: ({ owner, repository, pullRequestNumber }) => getPullRequestFiles(
        owner,
        repository,
        pullRequestNumber,
        dependencies
      )
    }
  );
}

export async function getPullRequestFiles(
  owner: string,
  repository: string,
  pullRequestNumber: number,
  dependencies: GitHubPullRequestsDependencies = defaultDependencies
): Promise<GitHubPullRequestFile[]> {
  const normalizedOwner = validateRepositoryPart(owner, "propriétaire");
  const normalizedRepository = validateRepositoryPart(repository, "dépôt");

  if (!Number.isInteger(pullRequestNumber) || pullRequestNumber < 1) {
    throw new Error("Le numéro de PR GitHub est invalide.");
  }

  const token = await dependencies.readCredential();
  const files = await fetchGitHubCollection<GitHubPullRequestFileResponse>(
    `https://api.github.com/repos/${encodeURIComponent(normalizedOwner)}/${encodeURIComponent(normalizedRepository)}/pulls/${pullRequestNumber}/files?per_page=100`,
    token,
    dependencies,
    `fichiers de la PR #${pullRequestNumber}`
  );

  return files.map((file) => ({
    additions: file.additions,
    blobUrl: file.blob_url,
    changes: file.changes,
    deletions: file.deletions,
    filename: file.filename,
    patch: file.patch ?? null,
    previousFilename: file.previous_filename ?? null,
    status: file.status
  }));
}

export async function listOpenPullRequests(
  owner: string,
  repository: string,
  dependencies: GitHubPullRequestsDependencies = defaultDependencies
): Promise<GitHubPullRequest[]> {
  const normalizedOwner = validateRepositoryPart(owner, "propriétaire");
  const normalizedRepository = validateRepositoryPart(repository, "dépôt");
  const token = await dependencies.readCredential();
  const repositoryUrl = `https://api.github.com/repos/${encodeURIComponent(normalizedOwner)}/${encodeURIComponent(normalizedRepository)}`;
  const pullRequests = await fetchGitHubCollection<GitHubPullRequestResponse>(
    `${repositoryUrl}/pulls?state=open&per_page=100`,
    token,
    dependencies,
    "PR"
  );

  return mapWithConcurrency(pullRequests, 5, async (pullRequest) => {
    const pullRequestUrl = `${repositoryUrl}/pulls/${pullRequest.number}`;
    const [commits, conversationComments, reviewComments, reviews] = await Promise.all([
      fetchGitHubCollection<GitHubCommitResponse>(
        `${pullRequestUrl}/commits?per_page=100`, token, dependencies, `commits de la PR #${pullRequest.number}`
      ),
      fetchGitHubCollection<GitHubCommentResponse>(
        `${repositoryUrl}/issues/${pullRequest.number}/comments?per_page=100`, token, dependencies, `commentaires de la PR #${pullRequest.number}`
      ),
      fetchGitHubCollection<GitHubReviewCommentResponse>(
        `${pullRequestUrl}/comments?per_page=100`, token, dependencies, `commentaires de revue de la PR #${pullRequest.number}`
      ),
      fetchGitHubCollection<GitHubReviewResponse>(
        `${pullRequestUrl}/reviews?per_page=100`, token, dependencies, `validations de la PR #${pullRequest.number}`
      )
    ]);

    return {
      author: pullRequest.user?.login ?? "inconnu",
      comments: [
        ...conversationComments.map((comment) => ({
          author: comment.user?.login ?? "inconnu",
          body: comment.body,
          createdAt: comment.created_at,
          id: comment.id,
          kind: "conversation" as const
        })),
        ...reviewComments.map((comment) => ({
          author: comment.user?.login ?? "inconnu",
          body: comment.body,
          createdAt: comment.created_at,
          id: comment.id,
          kind: "review" as const,
          ...(comment.line === null ? {} : { line: comment.line }),
          path: comment.path
        }))
      ],
      commits: commits.map((commit) => ({
        author: commit.author?.login ?? commit.commit.author?.name ?? "inconnu",
        date: commit.commit.author?.date ?? null,
        message: commit.commit.message,
        sha: commit.sha
      })),
      labels: pullRequest.labels.map((label) => ({
        color: label.color,
        name: label.name
      })),
      number: pullRequest.number,
      reviews: reviews.map((review) => ({
        author: review.user?.login ?? "inconnu",
        body: review.body,
        id: review.id,
        state: review.state,
        submittedAt: review.submitted_at
      })),
      title: pullRequest.title
    };
  });
}

async function fetchGitHubCollection<T>(
  url: string,
  token: string,
  dependencies: GitHubPullRequestsDependencies,
  resourceName: string
): Promise<T[]> {
  const items: T[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const response = await dependencies.fetch(nextUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "Cortex",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    if (!response.ok) {
      throw new Error(
        `GitHub a refusé la récupération des ${resourceName} (${response.status} ${response.statusText}).`
      );
    }

    items.push(...await response.json() as T[]);
    nextUrl = getNextPageUrl(response.headers.get("link"));
  }

  return items;
}

function getNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }

  for (const link of linkHeader.split(",")) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput) => Promise<TOutput>
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );

  return results;
}

function validateRepositoryPart(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (!normalizedValue || normalizedValue === "." || normalizedValue === "..") {
    throw new Error(`Le ${fieldName} GitHub est invalide.`);
  }

  return normalizedValue;
}

function readGitHubCredential(): Promise<string> {
  return new Promise((resolve, reject) => {
    const credentialProcess = spawn("git", ["credential", "fill"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";

    credentialProcess.stdout.setEncoding("utf8");
    credentialProcess.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    credentialProcess.stderr.setEncoding("utf8");
    credentialProcess.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    credentialProcess.on("error", reject);
    credentialProcess.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(stderr.trim() || "Git Credential Manager n'a renvoyé aucun identifiant."));
        return;
      }

      const credential = Object.fromEntries(
        stdout
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => {
            const separatorIndex = line.indexOf("=");
            return separatorIndex === -1
              ? [line, ""]
              : [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
          })
      );
      const token = credential.password?.trim();

      if (!token) {
        reject(new Error("Aucun identifiant GitHub n'est disponible dans Git Credential Manager."));
        return;
      }

      resolve(token);
    });
    credentialProcess.stdin.end("protocol=https\nhost=github.com\n\n");
  });
}