# --- CloudWatch Log Groups ---
resource "aws_cloudwatch_log_group" "agent" {
  name              = "/${var.project_name}/agent"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "lnd" {
  name              = "/${var.project_name}/lnd"
  retention_in_days = 60
}

resource "aws_cloudwatch_log_group" "transactions" {
  name              = "/${var.project_name}/transactions"
  retention_in_days = 90
}

# --- SNS Topic ---
resource "aws_sns_topic" "alerts" {
  name = "${var.project_name}-alerts"
}

# --- Alarms ---
resource "aws_cloudwatch_metric_alarm" "instance_health" {
  alarm_name          = "${var.project_name}-instance-health"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "EC2 instance health check failed"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    InstanceId = aws_instance.ln_agent.id
  }
}
