import XCTest

final class FamilyOrganizerUITests: XCTestCase {
  private var app: XCUIApplication!
  private var deviceAccessKey: String? {
    let value = ProcessInfo.processInfo.environment["UITEST_DEVICE_ACCESS_KEY"]?.trimmingCharacters(in: .whitespacesAndNewlines)
      ?? repoEnvValue(named: "DEVICE_ACCESS_KEY")
    return (value?.isEmpty == false) ? value : nil
  }
  private var childPin: String { ProcessInfo.processInfo.environment["UITEST_CHILD_PIN"] ?? "5543" }
  private var parentPin: String { ProcessInfo.processInfo.environment["UITEST_PARENT_PIN"] ?? "1234" }

  override func setUpWithError() throws {
    continueAfterFailure = false
    app = XCUIApplication()
    app.launchArguments.append("--ui-testing")
    app.launch()
  }

  func testChildLoginAndSwitchUserFlow() throws {
    waitForLockScreen()

    app.buttons["member-card-judah"].tap()
    enterPin(childPin)
    tapUnlockButton()

    let choresSwitchButton = app.buttons["chores-switch-user-button"]
    if !choresSwitchButton.waitForExistence(timeout: 15) {
      failWithLockStateContext("Expected chores screen after Judah login")
    }
    choresSwitchButton.tap()

    XCTAssertTrue(app.buttons["member-card-judah"].waitForExistence(timeout: 10), "Expected lock screen after Switch User")
  }

  func testParentElevationAndLockFromMoreTab() throws {
    waitForLockScreen()

    app.buttons["member-card-david"].tap()
    enterPin(parentPin)
    tapUnlockButton()

    let choresSwitchButton = app.buttons["chores-switch-user-button"]
    if !choresSwitchButton.waitForExistence(timeout: 15) {
      failWithLockStateContext("Expected chores screen after parent unlock")
    }

    let moreTab = resolveTabButton(
      preferredIDs: ["tab-more"],
      labelFallbackContains: "More",
      fallbackIndex: 3
    )
    XCTAssertTrue(moreTab.waitForExistence(timeout: 5), "Expected More tab")
    moreTab.tap()

    let lockButton = app.buttons["more-lock-app-button"]
    XCTAssertTrue(lockButton.waitForExistence(timeout: 10), "Expected Lock App button in More tab")
    lockButton.tap()

    XCTAssertTrue(app.buttons["member-card-david"].waitForExistence(timeout: 10), "Expected lock screen after Lock App")
  }

  private func waitForLockScreen() {
    ensureActivatedIfNeeded()
    if app.buttons["member-card-judah"].waitForExistence(timeout: 20) {
      return
    }

    let choresSwitchButton = app.buttons["chores-switch-user-button"]
    if choresSwitchButton.waitForExistence(timeout: 2) {
      choresSwitchButton.tap()
      XCTAssertTrue(app.buttons["member-card-judah"].waitForExistence(timeout: 10), "Expected family member cards after Switch User")
      return
    }

    let moreLockButton = app.buttons["more-lock-app-button"]
    if moreLockButton.waitForExistence(timeout: 2) {
      moreLockButton.tap()
      XCTAssertTrue(app.buttons["member-card-judah"].waitForExistence(timeout: 10), "Expected family member cards after Lock App")
      return
    }

    attachDebugScreenshot(named: "wait-for-lock-screen-failure")
    XCTFail("Expected family member cards or a recoverable authenticated screen")
  }

  private func ensureActivatedIfNeeded() {
    let activationTitle = app.staticTexts["Activate this iPhone"]
    guard activationTitle.waitForExistence(timeout: 2) else { return }

    guard let key = deviceAccessKey else {
      XCTFail("App is on activation screen but UITEST_DEVICE_ACCESS_KEY was not provided")
      return
    }

    let keyInput = app.textFields["activation-key-input"]
    XCTAssertTrue(keyInput.waitForExistence(timeout: 10), "Expected activation key input")
    keyInput.tap()
    keyInput.typeText(key)

    let activateButton = app.buttons["activate-device-button"]
    XCTAssertTrue(activateButton.waitForExistence(timeout: 5), "Expected activate button")
    activateButton.tap()
  }

  private func enterPin(_ pin: String) {
    let secure = app.secureTextFields["member-pin-input"]
    let text = app.textFields["member-pin-input"]
    let field = secure.waitForExistence(timeout: 10) ? secure : text
    XCTAssertTrue(field.exists, "Expected PIN input")
    field.tap()
    field.typeText(pin)
  }

  private func tapUnlockButton() {
    var button = app.buttons["member-confirm-button"]
    XCTAssertTrue(button.waitForExistence(timeout: 10), "Expected unlock button")
    XCTAssertTrue(button.isEnabled, "Expected unlock button to be enabled before tap")

    if app.keyboards.element.exists {
      attachDebugScreenshot(named: "unlock-keyboard-visible")
    }

    if !button.isHittable {
      dismissKeyboardIfPresent()
      RunLoop.current.run(until: Date().addingTimeInterval(0.25))
    }

    var attempts = 0
    while attempts < 4 {
      button = app.buttons["member-confirm-button"]
      let keyboardVisible = app.keyboards.element.exists
      let keyboardOverlapsButton = isButtonOverlappedByKeyboard(button)
      if button.isHittable && !keyboardOverlapsButton {
        break
      }

      if keyboardVisible || keyboardOverlapsButton {
        attachDebugScreenshot(named: "unlock-overlap-attempt-\(attempts + 1)")
      }

      app.swipeUp()
      // Allow scroll deceleration to finish before checking/tapping again.
      RunLoop.current.run(until: Date().addingTimeInterval(0.45))
      attempts += 1
    }

    button = app.buttons["member-confirm-button"]
    if isButtonOverlappedByKeyboard(button) {
      attachDebugScreenshot(named: "unlock-still-overlapped")
      XCTFail("Unlock button is overlapped by the keyboard; aborting tap to avoid hitting a keyboard key.")
      return
    }

    if !button.isHittable {
      let coord = button.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      coord.tap()
    } else {
      button.tap()
    }

    // Retry once if the first tap was consumed by scroll settling.
    if app.buttons["member-confirm-button"].exists && !app.buttons["chores-switch-user-button"].exists {
      RunLoop.current.run(until: Date().addingTimeInterval(0.35))
      let retryButton = app.buttons["member-confirm-button"]
      if retryButton.exists && retryButton.isEnabled {
        if retryButton.isHittable {
          retryButton.tap()
        } else {
          retryButton.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
      }
    }
  }

  private func isButtonOverlappedByKeyboard(_ button: XCUIElement) -> Bool {
    let keyboard = app.keyboards.element
    guard keyboard.exists else { return false }
    let keyboardFrame = keyboard.frame
    let buttonFrame = button.frame
    guard !keyboardFrame.isEmpty, !buttonFrame.isEmpty else { return false }
    return buttonFrame.maxY > (keyboardFrame.minY - 4)
  }

  private func dismissKeyboardIfPresent() {
    guard app.keyboards.element.exists else { return }

    let candidateLabels = ["Return", "Done", "Go", "Join", "OK", "Hide keyboard"]
    for label in candidateLabels {
      let key = app.keyboards.buttons[label]
      if key.exists && key.isHittable {
        key.tap()
        return
      }
    }

    // Fallback tap near top to dismiss keyboard when no obvious action key exists.
    let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1))
    top.tap()
  }

  private func repoEnvValue(named key: String) -> String? {
    let envPath = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent() // FamilyOrganizerUITests/
      .deletingLastPathComponent() // ios/
      .deletingLastPathComponent() // mobile/
      .deletingLastPathComponent() // repo root
      .appendingPathComponent(".env.local")

    guard let contents = try? String(contentsOf: envPath, encoding: .utf8) else { return nil }

    for rawLine in contents.split(separator: "\n") {
      let line = rawLine.trimmingCharacters(in: .whitespaces)
      guard !line.isEmpty, !line.hasPrefix("#") else { continue }
      guard line.hasPrefix("\(key)=") else { continue }
      let value = String(line.dropFirst(key.count + 1)).trimmingCharacters(in: .whitespacesAndNewlines)
      return stripOptionalQuotes(value)
    }

    return nil
  }

  private func resolveTabButton(
    preferredIDs: [String],
    labelFallbackContains label: String,
    fallbackIndex: Int
  ) -> XCUIElement {
    for id in preferredIDs {
      let button = app.tabBars.buttons[id]
      if button.exists { return button }
    }

    let byLabel = app.tabBars.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", label)).firstMatch
    if byLabel.exists { return byLabel }

    return app.tabBars.buttons.element(boundBy: fallbackIndex)
  }

  private func stripOptionalQuotes(_ value: String) -> String {
    guard value.count >= 2 else { return value }
    if (value.hasPrefix("\"") && value.hasSuffix("\"")) || (value.hasPrefix("'") && value.hasSuffix("'")) {
      return String(value.dropFirst().dropLast())
    }
    return value
  }

  private func failWithLockStateContext(_ message: String) {
    attachDebugScreenshot(named: "lock-state-failure")

    let lockError = app.descendants(matching: .any)["lock-error-message"]
    if lockError.exists {
      let errorText = (lockError.label.isEmpty ? lockError.value as? String : lockError.label) ?? "<no text>"
      XCTFail("\(message). Lock error: \(errorText)")
      return
    }

    if app.buttons["member-card-judah"].exists || app.buttons["member-card-david"].exists {
      XCTFail("\(message). App appears to be back on member picker with no explicit error text.")
      return
    }

    let selectedMemberPanelError = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "PIN")).firstMatch
    if selectedMemberPanelError.exists {
      XCTFail("\(message). Still on lock detail panel.")
      return
    }

    XCTFail("\(message). Unknown screen state.")
  }

  private func attachDebugScreenshot(named name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
