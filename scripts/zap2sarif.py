import json
import argparse
import re

def clean_uri(uri):
    if not uri:
        return "unknown-url"
    # Remove scheme (http:// or https://)
    cleaned = re.sub(r'^\w+://', '', uri)
    # Remove port (e.g. :8080)
    cleaned = re.sub(r':\d+', '', cleaned)
    # Remove trailing slash
    cleaned = cleaned.rstrip('/')
    return cleaned

def main(file_in, file_out):
    try:
        with open(file_in, 'r', encoding='utf-8') as file:
            zap_data = json.load(file)
    except Exception as e:
        print(f"Error loading ZAP report: {e}")
        # Write empty valid SARIF to not fail downstream steps
        write_empty_sarif(file_out)
        return

    # Initializing SARIF structure
    sarif = {
        "version": "2.1.0",
        "$schema": "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json",
        "runs": [{
            "tool": {
                "driver": {
                    "name": "OWASP ZAP",
                    "version": zap_data.get("@version", "2.14.0"),
                    "informationUri": "https://www.zaproxy.org/",
                    "rules": []
                }
            },
            "results": []
        }]
    }

    # Dictionary to register unique rules
    rule_ids = {}

    # Processing each alert
    for site in zap_data.get("site", []):
        for alert in site.get("alerts", []):
            rule_id = f"ZAP-{alert.get('pluginid', alert.get('alertRef', 'unknown'))}"
            
            # Map riskcode to GHA severity level (error, warning, note)
            riskcode = alert.get("riskcode", "0")
            level = "note"
            if riskcode == "3":
                level = "error"
            elif riskcode in ("2", "1"):
                level = "warning"

            cwe_id = alert.get("cweid", "")
            tags = [alert.get("riskdesc", "")]
            if cwe_id and cwe_id != "-1":
                tags.append(f"external/cwe/cwe-{cwe_id}")

            if rule_id not in rule_ids:
                sarif["runs"][0]["tool"]["driver"]["rules"].append({
                    "id": rule_id,
                    "name": alert.get("name", alert.get("alert", "ZAP Alert")),
                    "shortDescription": {"text": alert.get("alert", alert.get("name", "ZAP Alert"))},
                    "fullDescription": {"text": clean_html(alert.get("desc", ""))},
                    "help": {
                        "text": clean_html(alert.get("solution", "")), 
                        "markdown": clean_html(alert.get("solution", ""))
                    },
                    "properties": {
                        "tags": tags,
                        "defaultConfiguration": {"level": level}
                    }
                })
                rule_ids[rule_id] = True

            for instance in alert.get("instances", []):
                uri = instance.get("uri", "")
                cleaned_uri = clean_uri(uri)
                
                # Create detailed message matching SvanBoxel design
                message_parts = [
                    f"**{alert.get('name', 'ZAP Alert')}**",
                    f"\n\n**Description:** {alert.get('desc', '')}",
                    f"\n**URI:** {uri}",
                    f"\n**Method:** {instance.get('method', '')}"
                ]
                if instance.get("param"):
                    message_parts.append(f"\n**Parameter:** {instance.get('param')}")
                if instance.get("evidence"):
                    message_parts.append(f"\n**Evidence:** {instance.get('evidence')}")
                if instance.get("otherinfo"):
                    message_parts.append(f"\n**Other Info:** {instance.get('otherinfo')}")
                
                sarif["runs"][0]["results"].append({
                    "ruleId": rule_id,
                    "level": level,
                    "message": {"text": "".join(message_parts)},
                    "locations": [{
                        "physicalLocation": {
                            "artifactLocation": {
                                "uri": cleaned_uri
                            },
                            "region": {
                                "startLine": 1
                            }
                        },
                        "logicalLocations": [{
                            "name": uri,
                            "kind": instance.get("method", "GET")
                        }]
                    }],
                    "properties": {
                        "confidence": alert.get("confidence", ""),
                        "evidence": instance.get("evidence", ""),
                        "parameter": instance.get("param", ""),
                        "method": instance.get("method", "")
                    }
                })

    # Saving SARIF file
    try:
        with open(file_out, 'w', encoding='utf-8') as sarif_file:
            json.dump(sarif, sarif_file, indent=2)
        print(f"SARIF report generated at {file_out}")
    except Exception as e:
        print(f"Error saving SARIF report: {e}")

def clean_html(text):
    if not text:
        return ""
    # Strip basic HTML tags
    cleaned = re.sub(r'<p>', '', text)
    cleaned = re.sub(r'</p>', '\n', cleaned)
    cleaned = re.sub(r'<br\s*/?>', '\n', cleaned)
    return cleaned

def write_empty_sarif(file_out):
    sarif = {
        "version": "2.1.0",
        "$schema": "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json",
        "runs": [{
            "tool": {
                "driver": {
                    "name": "OWASP ZAP",
                    "informationUri": "https://www.zaproxy.org/",
                    "rules": []
                }
            },
            "results": []
        }]
    }
    with open(file_out, 'w', encoding='utf-8') as f:
        json.dump(sarif, f, indent=2)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert ZAP JSON report to SARIF format.")
    parser.add_argument("file_in", help="Input ZAP JSON file")
    parser.add_argument("file_out", help="Output SARIF JSON file")
    args = parser.parse_args()
    main(args.file_in, args.file_out)
