export type WorkflowParameterInputType = "text" | "textarea" | "select";

export interface WorkflowParameterDefinition {
  id: string;
  label: string;
  description: string;
  required: boolean;
  inputType: WorkflowParameterInputType;
  placeholder: string;
  options: string[];
}

export type WorkflowParameterValues = Record<string, string>;
