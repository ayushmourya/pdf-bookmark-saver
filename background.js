console.log("Popup script initialized");

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  console.log("Queried active tab:", tabs);
  checkIfPDF(tabs[0]);
});

document.getElementById("saveCurrentPage").addEventListener("click", () => {
  console.log("Save button clicked");

  chrome.tabs.sendMessage(
    currentTab.id,
    { action: "getCurrentPage" },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error:", chrome.runtime.lastError.message);
        showFeedback(`Error: ${chrome.runtime.lastError.message}`, false);
        saveButton.disabled = false;
      } else {
        console.log("Message received, response:", response);
      }
    }
  );
});
