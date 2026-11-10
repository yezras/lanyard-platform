export type StagingFileRecord = {
  path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
};

export type StagingStorageProvider = {
  writeFile(input: {
    path: string;
    filename: string;
    mime_type: string;
    bytes: Uint8Array;
  }): Promise<StagingFileRecord>;

  listFiles(): Promise<StagingFileRecord[]>;

  readFile(path: string): Promise<StagingFileRecord | null>;
};