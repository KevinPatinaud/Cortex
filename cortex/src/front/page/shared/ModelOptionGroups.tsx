import { groupCatalogModels, type CodexModel } from "../../../shared/CodexModel.ts";

interface Props {
  models: readonly CodexModel[];
  formatLabel?: (model: CodexModel) => string;
}

export function ModelOptionGroups({
  models,
  formatLabel = model => model.displayName
}: Props) {
  const groups = groupCatalogModels(models);
  if (groups.length <= 1) {
    return <>
      {models.map(candidate => (
        <option key={candidate.model} value={candidate.model}>{formatLabel(candidate)}</option>
      ))}
    </>;
  }
  return <>
    {groups.map(group => (
      <optgroup key={group.engine} label={group.label}>
        {group.models.map(candidate => (
          <option key={candidate.model} value={candidate.model}>{formatLabel(candidate)}</option>
        ))}
      </optgroup>
    ))}
  </>;
}
