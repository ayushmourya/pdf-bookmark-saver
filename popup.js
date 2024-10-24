let currentTab = null;

function showFeedback(message, isSuccess) {
  const feedback = document.getElementById("saveFeedback");
  feedback.textContent = message;
  feedback.className = "save-feedback " + (isSuccess ? "success" : "error");
  setTimeout(() => {
    feedback.className = "save-feedback";
  }, 3000);
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function updateBookmarksList() {
  chrome.storage.local.get(null, (data) => {
    const list = document.getElementById("bookmarksList");
    list.innerHTML = "";

    const bookmarks = Object.entries(data).sort(
      (a, b) => b[1].timestamp - a[1].timestamp
    );

    if (bookmarks.length === 0) {
      list.innerHTML = '<div class="no-bookmarks">No saved bookmarks yet</div>';
      return;
    }

    bookmarks.forEach(([key, value]) => {
      const item = document.createElement("div");
      item.className = "bookmark-item";

      const titleDiv = document.createElement("div");
      titleDiv.className = "bookmark-title";
      titleDiv.textContent = value.filename || "Unnamed PDF";

      const pageDiv = document.createElement("div");
      pageDiv.className = "bookmark-page";
      pageDiv.textContent = `Page ${value.pageNumber || 1}`;

      const dateDiv = document.createElement("div");
      dateDiv.className = "bookmark-date";
      dateDiv.textContent = `Saved on ${formatDate(value.timestamp)}`;

      const actionsDiv = document.createElement("div");
      actionsDiv.className = "bookmark-actions";

      const openButton = document.createElement("button");
      openButton.className = "open-btn";
      openButton.textContent = "Open PDF";
      openButton.addEventListener("click", () => openBookmark(key));

      const deleteButton = document.createElement("button");
      deleteButton.className = "delete-btn";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => deleteBookmark(key));

      actionsDiv.appendChild(openButton);
      actionsDiv.appendChild(deleteButton);

      item.appendChild(titleDiv);
      item.appendChild(pageDiv);
      item.appendChild(dateDiv);
      item.appendChild(actionsDiv);

      list.appendChild(item);
    });
  });
}

function checkIfPDF(tab) {
  currentTab = tab;
  const isPDF =
    tab.url.toLowerCase().endsWith(".pdf") ||
    tab.url.toLowerCase().includes("pdf");

  const saveButton = document.getElementById("saveCurrentPage");
  saveButton.disabled = !isPDF;

  if (!isPDF) {
    showFeedback("Open a PDF file to save bookmark", false);
  }
}

function saveCurrentPage() {
  const saveButton = document.getElementById("saveCurrentPage");

  if (!currentTab) {
    showFeedback("No active tab found", false);
    return;
  }

  saveButton.disabled = true;

  const pageNumberInput = prompt(
    "Enter the page number you want to bookmark:",
    "1"
  );

  if (
    !pageNumberInput ||
    isNaN(pageNumberInput) ||
    parseInt(pageNumberInput) <= 0
  ) {
    showFeedback("Invalid page number", false);
    saveButton.disabled = false;
    return;
  }

  const pageToSave = parseInt(pageNumberInput);
  const filename = currentTab.url.split("/").pop() || "Unnamed PDF";

  let baseUrl = currentTab.url.split("#")[0];
  baseUrl = baseUrl.split("?")[0];

  const bookmarkUrl = `${baseUrl}#page=${pageToSave}`;

  chrome.storage.local.set(
    {
      [`bookmark_${Date.now()}`]: {
        pageNumber: pageToSave,
        url: bookmarkUrl,
        filename: filename,
        timestamp: Date.now(),
      },
    },
    () => {
      saveButton.disabled = false;
      if (chrome.runtime.lastError) {
        showFeedback("Failed to save bookmark", false);
        console.error("Error saving bookmark:", chrome.runtime.lastError);
      } else {
        showFeedback(`Bookmark saved for page ${pageToSave}!`, true);
        updateBookmarksList();
      }
    }
  );
}

function injectPageNavigation(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId: tabId },
        func: () => {
          window.navigateToPage = async (pageNumber) => {
            const tryNavigation = async (attempts = 0, maxAttempts = 15) => {
              if (attempts >= maxAttempts) return false;

              try {
                if (window.PDFViewerApplication?.pdfViewer) {
                  const pdfViewer = window.PDFViewerApplication.pdfViewer;

                  if (!pdfViewer.pdfDocument) {
                    await new Promise((resolve) =>
                      window.PDFViewerApplication.eventBus.on(
                        "documentloaded",
                        resolve
                      )
                    );
                  }

                  await pdfViewer.scrollPageIntoView({ pageNumber });
                  window.PDFViewerApplication.page = pageNumber;
                  return true;
                }
              } catch (e) {
                console.log("PDF.js navigation failed:", e);
              }

              try {
                const viewer = document.querySelector(
                  'embed[type="application/pdf"]'
                );
                if (viewer) {
                  viewer.setAttribute("page", pageNumber);
                  return true;
                }
              } catch (e) {
                console.log("Google PDF viewer navigation failed:", e);
              }

              try {
                const pageInput = document.querySelector(
                  'input[type="number"][max]'
                );
                if (pageInput) {
                  pageInput.value = pageNumber;
                  pageInput.dispatchEvent(new Event("change"));
                  return true;
                }
              } catch (e) {
                console.log("Built-in viewer navigation failed:", e);
              }

              await new Promise((resolve) => setTimeout(resolve, 500));
              return tryNavigation(attempts + 1, maxAttempts);
            };

            return await tryNavigation();
          };
        },
      },
      (results) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(results);
        }
      }
    );
  });
}

async function openBookmark(key) {
  try {
    const data = await new Promise((resolve) => {
      chrome.storage.local.get([key], resolve);
    });

    const bookmark = data[key];
    if (!bookmark || !bookmark.url || !bookmark.pageNumber) {
      throw new Error("Invalid bookmark data");
    }

    const tab = await new Promise((resolve) => {
      chrome.tabs.create({ url: bookmark.url }, resolve);
    });

    await new Promise((resolve) => {
      function listener(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });

    await new Promise((resolve) => setTimeout(resolve, 3000));

    await injectPageNavigation(tab.id);

    const result = await new Promise((resolve) => {
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          func: (pageNum) => window.navigateToPage(pageNum),
          args: [bookmark.pageNumber],
        },
        (results) => {
          resolve(results?.[0]?.result);
        }
      );
    });

    if (result) {
      showFeedback(`Opened PDF at page ${bookmark.pageNumber}`, true);
    } else {
      chrome.tabs.update(tab.id, {
        url: `${bookmark.url}#page=${bookmark.pageNumber}`,
      });
      showFeedback("Opened PDF - using fallback navigation", true);
    }
  } catch (error) {
    console.error("Error opening bookmark:", error);
    showFeedback("Failed to open bookmark properly", false);
  }
}

function deleteBookmark(key) {
  if (confirm("Are you sure you want to delete this bookmark?")) {
    chrome.storage.local.remove(key, () => {
      if (chrome.runtime.lastError) {
        showFeedback("Failed to delete bookmark", false);
      } else {
        showFeedback("Bookmark deleted", true);
        updateBookmarksList();
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("saveCurrentPage")
    .addEventListener("click", saveCurrentPage);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      checkIfPDF(tabs[0]);
      updateBookmarksList();
    } else {
      showFeedback("No active tab found", false);
    }
  });
});
