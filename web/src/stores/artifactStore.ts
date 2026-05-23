import { create } from 'zustand'

export interface Artifact {
  id: string;
  title: string;
  type: string; // e.g. 'html', 'mermaid', 'react'
  content: string;
}

interface ArtifactState {
  activeArtifact: Artifact | null;
  isOpen: boolean;
  setActiveArtifact: (artifact: Artifact) => void;
  closeArtifact: () => void;
}

export const useArtifactStore = create<ArtifactState>((set) => ({
  activeArtifact: null,
  isOpen: false,
  setActiveArtifact: (artifact) => set({ activeArtifact: artifact, isOpen: true }),
  closeArtifact: () => set({ isOpen: false }),
}))
