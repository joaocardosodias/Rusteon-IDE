export interface CrateInfo {
  name: string;
  description: string;
  newest_version: string;
  downloads: number;
  recent_downloads: number;
  repository: string | null;
  homepage: string | null;
  documentation: string | null;
  exact_match: boolean;
}

export interface CratesSearchResponse {
  crates: CrateInfo[];
  meta: {
    total: number;
  };
}

export async function searchCrates(query: string, page: number = 1, perPage: number = 20): Promise<CratesSearchResponse> {
  // Using pure fetch inside the WebView
  // A crates.io user-agent logic is highly recommended by them, but fetch web API makes it tricky due to CORS sometimes, 
  // though recent Rust HTTP APIs allow it.
  const url = `https://crates.io/api/v1/crates?q=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}`;
  
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch crates: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export interface CrateVersion {
  num: string;       // version number e.g "0.21.0"
  yanked: boolean;
  created_at: string;
}

export async function getCrateVersions(crateName: string): Promise<CrateVersion[]> {
  const url = `https://crates.io/api/v1/crates/${encodeURIComponent(crateName)}/versions`;

  const response = await fetch(url, {
    headers: { "Accept": "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch versions for ${crateName}: ${response.statusText}`);
  }

  const data = await response.json();
  // Return only non-yanked versions, newest first (API already returns newest first)
  return (data.versions as CrateVersion[]).filter(v => !v.yanked).slice(0, 20);
}
