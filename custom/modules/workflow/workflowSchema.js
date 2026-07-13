export function validateWorkflowDefinition(workflow) {
  const errors = [];

  if (!workflow || typeof workflow !== 'object') {
    return ['Workflow must be an object.'];
  }
  if (!workflow.id) {
    errors.push('Workflow id is required.');
  }
  if (!workflow.name) {
    errors.push('Workflow name is required.');
  }
  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    errors.push('Workflow must include at least one step.');
  }

  return errors;
}
