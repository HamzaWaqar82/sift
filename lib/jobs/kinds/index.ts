// Every job kind, registered by importing its module. Later kinds (mail.send, triage.auto,
// triage.manual, assign.ack_timeout, ticket.overdue_sweep) add one import line here.
import "./mail-test";
import "./triage";
