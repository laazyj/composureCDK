import { type IReceiptRuleAction } from "aws-cdk-lib/aws-ses";
import { AddHeader } from "aws-cdk-lib/aws-ses-actions";

/** Adds a custom header to the received mail. */
export function addHeaderAction(name: string, value: string): IReceiptRuleAction {
  return new AddHeader({ name, value });
}
