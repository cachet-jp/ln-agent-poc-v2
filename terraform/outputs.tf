output "instance_id" {
  value = aws_instance.ln_agent.id
}

output "public_ip" {
  value = aws_eip.ln_agent.public_ip
}

output "s3_bucket" {
  value = aws_s3_bucket.poc.bucket
}

output "ssm_connect" {
  value = "aws ssm start-session --target ${aws_instance.ln_agent.id} --profile sandbox"
}

output "ssh_connect" {
  value = "ssh -i ~/.ssh/ln-agent-poc ubuntu@${aws_eip.ln_agent.public_ip}"
}

output "lnd_uri_hint" {
  value = "LN Node URI will be: <pubkey>@${aws_eip.ln_agent.public_ip}:9735"
}
