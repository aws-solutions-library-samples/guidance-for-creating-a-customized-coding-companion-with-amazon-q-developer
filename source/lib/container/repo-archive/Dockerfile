FROM amazon/aws-cli

# install prerequisites
RUN yum install -y git unzip

# add main script
ADD archive.sh .

# grant user execute permissions
RUN chmod +x archive.sh

ENTRYPOINT [ "" ]
CMD ["./archive.sh"]