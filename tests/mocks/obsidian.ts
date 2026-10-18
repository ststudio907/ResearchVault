/** Runtime API used by sidebar-opening tests; vi.mock supplies the implementation. */
export function requireApiVersion(_version: string): boolean {
  throw new Error('Mock requireApiVersion before exercising Obsidian APIs.');
}
