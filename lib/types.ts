export type PatientMetrics = {
  eGFR?: number;
  LVEF?: number;
  PASI?: number;
  Eosinophils?: number;
  FEV1?: number;
};

export type Patient = {
  id: string;
  name: string;
  age: number;
  conditions: string[];
  metrics: PatientMetrics;
};

export type RiskLevel = "CRITICAL" | "HIGH" | "MODERATE";

export type CohortMatch = {
  patient: Patient;
  risk_level: RiskLevel;
  match_reasons: string[];
  recommended_action: string;
};

export type Study = {
  pmid: string;
  title: string;
  journal: string;
  publication_date?: string;
  abstract?: string;
  key_findings?: string;
};

export type PaperAnalysis = Study & {
  inclusion_criteria?: string[];
  exclusion_criteria?: string[];
  target_biomarkers?: Record<string, string>;
  safety_signals?: string[];
};

export type IngestResponse = {
  file_id: string;
  response_id?: string;
  analysis: string;
  model?: string;
};

export type VoiceSecretResponse = {
  value?: string;
  client_secret?: string | { value?: string };
  detail?: string;
};
