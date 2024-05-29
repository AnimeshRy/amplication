import { gql } from "@apollo/client";

export const COMMIT_FIELDS_FRAGMENT = gql`
  fragment CommitFields on Commit {
    id
    message
    createdAt
    user {
      id
      account {
        firstName
        lastName
      }
    }
    changes {
      originId
      action
      originType
      versionNumber
      origin {
        __typename
        ... on Entity {
          id
          displayName
          updatedAt
        }
        ... on Block {
          id
          displayName
          updatedAt
          blockType
        }
      }
      resource {
        id
        name
        resourceType
      }
    }
    builds {
      id
      createdAt
      resourceId
      resource {
        id
        name
        resourceType
      }
      version
      message
      createdAt
      commitId
      commit {
        createdAt
        user {
          account {
            firstName
            lastName
          }
        }
      }
      actionId
      action {
        id
        createdAt
        steps {
          id
          name
          createdAt
          message
          status
          completedAt
          logs {
            id
            createdAt
            message
            meta
            level
          }
        }
      }
      createdBy {
        id
        account {
          firstName
          lastName
        }
      }
      status
      archiveURI
    }
  }
`;

export const GET_COMMITS = gql`
  ${COMMIT_FIELDS_FRAGMENT}
  query commits(
    $projectId: String!
    $take: Int!
    $skip: Int!
    $orderBy: CommitOrderByInput
  ) {
    commits(
      where: { project: { id: $projectId } }
      take: $take
      skip: $skip
      orderBy: $orderBy
    ) {
      ...CommitFields
    }
  }
`;

export const GET_COMMIT = gql`
  ${COMMIT_FIELDS_FRAGMENT}
  query Commit($commitId: String!) {
    commit(where: { id: $commitId }) {
      ...CommitFields
    }
  }
`;
