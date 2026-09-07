export interface ProjectFolder {
  id: string;
  name: string;
}

export interface ProjectOrganization {
  folders: ProjectFolder[];
  projectFolders: Record<string, string>;
}
