// src/services/project-manager.ts

export class ProjectManager {
  constructor(private plugin: ResearchVaultPlugin);
  
  // CRUD
  async createProject(config: ProjectCreateConfig): Promise<Project>;
  async updateProject(id: string, updates: Partial<Project>): Promise<Project>;
  async deleteProject(id: string): Promise<void>;
  
  // Switching
  async activateProject(id: string): Promise<void>;
  getActiveProject(): Project | null;
  
  // Queries
  getAllProjects(): Project[];
  getProjectById(id: string): Project | undefined;
  getProjectStats(id: string): ProjectStats;
  
  // File operations
  getProjectFiles(projectId: string): TFile[];
  getProjectPapers(projectId: string): Paper[];
  
  // Events
  onProjectChanged: EventEmitter<Project>;
  onProjectStatsUpdated: EventEmitter<ProjectStats>;
}