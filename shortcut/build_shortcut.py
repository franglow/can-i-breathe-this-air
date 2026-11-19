#!/usr/bin/env python3
"""Builds the "Morning Air" Apple Shortcut used by the Notify me button.

The Shortcut gets the device location, asks Open-Meteo for the European AQI
and shows a notification such as:

    Can I breathe this air?
    Air here today: Mostly breathable · EU AQI 52

Usage (on a Mac, signed in to iCloud):

    python3 shortcut/build_shortcut.py

This writes shortcut/morning-air.unsigned.shortcut and then signs it with
Apple's `shortcuts sign --mode anyone` into "shortcut/Morning Air.shortcut",
the file the website offers. iPhones and Macs only import signed Shortcuts.
"""

import plistlib
import subprocess
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
UNSIGNED = HERE / "morning-air.unsigned.shortcut"
SIGNED = HERE / "Morning Air.shortcut"  # file name becomes the Shortcut name

AIR_URL = (
    "https://air-quality-api.open-meteo.com/v1/air-quality"
    "?latitude={lat}&longitude={lon}&current=european_aqi&timezone=auto"
)

# Same wording as the share card (BREATH_LEVELS in aqi.js).
# List index = ceil(EAQI / 20) + 1, so: 0 -> 1, 1-20 -> 2, 21-40 -> 3, ...
# Shortcuts has no min(), so the list is padded with "Stay in" up to EAQI 600.
VERDICTS = ["Breathe easy", "Breathe easy", "Breathable", "Mostly breathable", "Not great"]
VERDICTS += ["Stay in"] * (32 - len(VERDICTS))

OBJ = "￼"  # placeholder character Shortcuts uses for inline variables


def uid():
    return str(uuid.uuid4()).upper()


def output(action_uuid, name, prop=None):
    """Reference to an earlier action's output (optionally one of its properties)."""
    ref = {"Type": "ActionOutput", "OutputUUID": action_uuid, "OutputName": name}
    if prop:
        ref["Aggrandizements"] = [{"Type": "WFPropertyVariableAggrandizement", "PropertyName": prop}]
    return ref


def attachment(ref):
    return {"Value": ref, "WFSerializationType": "WFTextTokenAttachment"}


def text(template, *refs):
    """Text with inline variables: every '{}' in template is replaced by a ref, in order."""
    parts = template.split("{}")
    assert len(parts) == len(refs) + 1, template
    string, ranges = parts[0], {}
    for ref, rest in zip(refs, parts[1:]):
        ranges[f"{{{len(string.encode('utf-16-le')) // 2}, 1}}"] = ref
        string += OBJ + rest
    return {
        "Value": {"string": string, "attachmentsByRange": ranges},
        "WFSerializationType": "WFTextTokenString",
    }


def action(identifier, **params):
    return {"WFWorkflowActionIdentifier": identifier, "WFWorkflowActionParameters": params}


def build():
    loc, url, fetch, current, aqi = uid(), uid(), uid(), uid(), uid()
    divide, level, verdicts, verdict = uid(), uid(), uid(), uid()

    actions = [
        action("is.workflow.actions.comment", WFCommentActionText=(
            "Morning air check from can-i-breathe-this-air.pages.dev.\n"
            "Run it from a daily Personal Automation (Shortcuts > Automation > Time of Day)."
        )),
        action("is.workflow.actions.getcurrentlocation", UUID=loc),
        action(
            "is.workflow.actions.gettext",
            UUID=url,
            WFTextActionText=text(
                AIR_URL.replace("{lat}", "{}").replace("{lon}", "{}"),
                output(loc, "Current Location", "Latitude"),
                output(loc, "Current Location", "Longitude"),
            ),
        ),
        action(
            "is.workflow.actions.downloadurl",
            UUID=fetch,
            WFHTTPMethod="GET",
            WFURL=text("{}", output(url, "Text")),
        ),
        action(
            "is.workflow.actions.getvalueforkey",
            UUID=current,
            WFGetDictionaryValueType="Value",
            WFDictionaryKey="current",
            WFInput=attachment(output(fetch, "Contents of URL")),
        ),
        action(
            "is.workflow.actions.getvalueforkey",
            UUID=aqi,
            WFGetDictionaryValueType="Value",
            WFDictionaryKey="european_aqi",
            WFInput=attachment(output(current, "Dictionary Value")),
        ),
        # level index = ceil(aqi / 20) + 1
        action(
            "is.workflow.actions.math",
            UUID=divide,
            WFInput=attachment(output(aqi, "Dictionary Value")),
            WFMathOperation="÷",
            WFMathOperand=20,
        ),
        action(
            "is.workflow.actions.round",
            UUID=level,
            WFInput=attachment(output(divide, "Calculation Result")),
            WFRoundMode="Always Round Up",
            WFRoundTo="Ones Place",
        ),
        action("is.workflow.actions.list", UUID=verdicts, WFItems=VERDICTS),
        action(
            "is.workflow.actions.math",
            UUID=(index := uid()),
            WFInput=attachment(output(level, "Rounded Number")),
            WFMathOperation="+",
            WFMathOperand=1,
        ),
        action(
            "is.workflow.actions.getitemfromlist",
            UUID=verdict,
            WFInput=attachment(output(verdicts, "List")),
            WFItemSpecifier="Item At Index",
            WFItemIndex=attachment(output(index, "Calculation Result")),
        ),
        action(
            "is.workflow.actions.notification",
            WFNotificationActionTitle="Can I breathe this air?",
            WFNotificationActionBody=text(
                "Air here today: {} · EU AQI {}",
                output(verdict, "Item from List"),
                output(aqi, "Dictionary Value"),
            ),
            WFNotificationActionSound=True,
        ),
    ]

    return {
        "WFWorkflowClientVersion": "2302.0.4",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4292093695, "WFWorkflowIconGlyphNumber": 59511},
        "WFWorkflowImportQuestions": [],
        "WFWorkflowTypes": [],
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": False,
        "WFQuickActionSurfaces": [],
        "WFWorkflowActions": actions,
    }


def main():
    with UNSIGNED.open("wb") as f:
        plistlib.dump(build(), f, fmt=plistlib.FMT_BINARY)
    print(f"Wrote {UNSIGNED.name}")
    if "--no-sign" in sys.argv:
        return
    subprocess.run(
        ["shortcuts", "sign", "--mode", "anyone", "--input", str(UNSIGNED), "--output", str(SIGNED)],
        check=True,
    )
    print(f"Signed {SIGNED.name}")


if __name__ == "__main__":
    main()
