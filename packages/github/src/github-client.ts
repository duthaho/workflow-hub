export type CheckConclusion = "success" | "failure" | "neutral";

export class GitHubClient {
  constructor(private readonly input: { owner: string; repo: string; token: string; fetcher?: typeof fetch }) {}

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await (this.input.fetcher ?? fetch)(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.input.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`GitHub API request failed: ${response.status}`);
    return response;
  }

  async createCheck(input: { name: string; headSha: string; conclusion: CheckConclusion; summary: string }): Promise<number> {
    const response = await this.request(`/repos/${encodeURIComponent(this.input.owner)}/${encodeURIComponent(this.input.repo)}/check-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: input.name, head_sha: input.headSha, status: "completed", conclusion: input.conclusion, output: { title: input.name, summary: input.summary } }),
    });
    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null || typeof (data as { id?: unknown }).id !== "number") throw new Error("GitHub API returned an invalid check run");
    return (data as { id: number }).id;
  }
}
