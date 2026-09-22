(() => {
  const button = document.getElementById("copy-task");
  const task = document.getElementById("model-task");
  const status = document.getElementById("copy-status");
  if (!button || !task || !status) return;
  button.hidden = false;
  button.addEventListener("click", async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(task.value);
      status.textContent = "Task copied. Give every official entrant the same version and baseline.";
    } catch (error) {
      task.focus();
      task.select();
      status.textContent = `Could not copy automatically: ${error.message} The task is selected; copy it manually.`;
    }
  });
})();
