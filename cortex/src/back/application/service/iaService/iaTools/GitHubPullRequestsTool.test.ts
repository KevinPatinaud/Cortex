import assert from "node:assert/strict";
import test from "node:test";
import {
  getPullRequestFiles,
  listOpenPullRequests,
  type GitHubPullRequestsDependencies
} from "./GitHubPullRequestsTool.ts";

test("récupère les fichiers et patches d'une pull request privée", async () => {
  const requestedUrls: string[] = [];
  let requestedHeaders: Headers | undefined;
  const dependencies: GitHubPullRequestsDependencies = {
    async readCredential() {
      return "github-token";
    },
    async fetch(input, init) {
      requestedUrls.push(input.toString());
      requestedHeaders = new Headers(init?.headers);

      return Response.json([{
        additions: 4,
        blob_url: "https://github.com/cortex/application/blob/abc123/src/search.ts",
        changes: 5,
        deletions: 1,
        filename: "src/search.ts",
        patch: "@@ -10,2 +10,5 @@\n-old\n+new",
        previous_filename: "src/find.ts",
        status: "renamed"
      }]);
    }
  };

  const files = await getPullRequestFiles(
    " cortex ",
    " application ",
    42,
    dependencies
  );

  assert.deepEqual(requestedUrls, [
    "https://api.github.com/repos/cortex/application/pulls/42/files?per_page=100"
  ]);
  assert.equal(requestedHeaders?.get("authorization"), "Bearer github-token");
  assert.deepEqual(files, [{
    additions: 4,
    blobUrl: "https://github.com/cortex/application/blob/abc123/src/search.ts",
    changes: 5,
    deletions: 1,
    filename: "src/search.ts",
    patch: "@@ -10,2 +10,5 @@\n-old\n+new",
    previousFilename: "src/find.ts",
    status: "renamed"
  }]);
});

test("liste et normalise les pull requests ouvertes", async () => {
  const requestedUrls: string[] = [];
  let requestedHeaders: Headers | undefined;
  const dependencies: GitHubPullRequestsDependencies = {
    async readCredential() {
      return "github-token";
    },
    async fetch(input, init) {
      const requestedUrl = input.toString();
      requestedUrls.push(requestedUrl);
      requestedHeaders = new Headers(init?.headers);

      if (requestedUrl.endsWith("/pulls?state=open&per_page=100")) {
        return Response.json([{
          number: 42,
          title: "Corrige la recherche",
          user: { login: "octocat" },
          labels: [{ name: "bug", color: "d73a4a" }]
        }]);
      }
      if (requestedUrl.endsWith("/pulls/42/commits?per_page=100")) {
        return Response.json([{
          sha: "abc123",
          commit: {
            message: "Corrige le filtre",
            author: { name: "Octo Cat", date: "2026-08-12T10:00:00Z" }
          },
          author: { login: "octocat" }
        }], {
          headers: {
            Link: "<https://api.github.com/repos/cortex/application/pulls/42/commits?per_page=100&page=2>; rel=\"next\""
          }
        });
      }
      if (requestedUrl.endsWith("/pulls/42/commits?per_page=100&page=2")) {
        return Response.json([{
          sha: "def456",
          commit: {
            message: "Ajoute le test",
            author: { name: "Review Bot", date: "2026-08-12T10:30:00Z" }
          },
          author: null
        }]);
      }
      if (requestedUrl.endsWith("/issues/42/comments?per_page=100")) {
        return Response.json([{
          id: 10,
          body: "Prêt à relire.",
          created_at: "2026-08-12T11:00:00Z",
          user: { login: "octocat" }
        }]);
      }
      if (requestedUrl.endsWith("/pulls/42/comments?per_page=100")) {
        return Response.json([{
          id: 11,
          body: "Ce cas doit être testé.",
          created_at: "2026-08-12T12:00:00Z",
          user: { login: "reviewer" },
          path: "src/search.ts",
          line: 18
        }]);
      }
      if (requestedUrl.endsWith("/pulls/42/reviews?per_page=100")) {
        return Response.json([{
          id: 12,
          body: "Validé.",
          state: "APPROVED",
          submitted_at: "2026-08-12T13:00:00Z",
          user: { login: "reviewer" }
        }]);
      }

      return new Response(null, { status: 404, statusText: "Not Found" });
    }
  };

  const pullRequests = await listOpenPullRequests(
    " cortex ",
    " application ",
    dependencies
  );

  assert.equal(requestedUrls.length, 6);
  assert.equal(requestedUrls[0], "https://api.github.com/repos/cortex/application/pulls?state=open&per_page=100");
  assert.equal(requestedHeaders?.get("authorization"), "Bearer github-token");
  assert.equal(requestedHeaders?.get("x-github-api-version"), "2022-11-28");
  assert.deepEqual(pullRequests, [
    {
      author: "octocat",
      comments: [
        {
          author: "octocat",
          body: "Prêt à relire.",
          createdAt: "2026-08-12T11:00:00Z",
          id: 10,
          kind: "conversation"
        },
        {
          author: "reviewer",
          body: "Ce cas doit être testé.",
          createdAt: "2026-08-12T12:00:00Z",
          id: 11,
          kind: "review",
          line: 18,
          path: "src/search.ts"
        }
      ],
      commits: [
        {
          author: "octocat",
          date: "2026-08-12T10:00:00Z",
          message: "Corrige le filtre",
          sha: "abc123"
        },
        {
          author: "Review Bot",
          date: "2026-08-12T10:30:00Z",
          message: "Ajoute le test",
          sha: "def456"
        }
      ],
      labels: [{ color: "d73a4a", name: "bug" }],
      number: 42,
      reviews: [{
        author: "reviewer",
        body: "Validé.",
        id: 12,
        state: "APPROVED",
        submittedAt: "2026-08-12T13:00:00Z"
      }],
      title: "Corrige la recherche"
    }
  ]);
});

test("rejette un nom de dépôt invalide avant de lire les identifiants", async () => {
  let credentialWasRead = false;
  const dependencies: GitHubPullRequestsDependencies = {
    async readCredential() {
      credentialWasRead = true;
      return "github-token";
    },
    async fetch() {
      throw new Error("La requête ne doit pas être effectuée.");
    }
  };

  await assert.rejects(
    listOpenPullRequests("cortex", "  ", dependencies),
    /The GitHub repository is invalid\./
  );
  assert.equal(credentialWasRead, false);
});

test("signale les refus de l'API GitHub", async () => {
  const dependencies: GitHubPullRequestsDependencies = {
    async readCredential() {
      return "github-token";
    },
    async fetch() {
      return new Response(null, {
        status: 403,
        statusText: "Forbidden"
      });
    }
  };

  await assert.rejects(
    listOpenPullRequests("cortex", "application", dependencies),
    /GitHub rejected the PR request \(403 Forbidden\)\./
  );
});
